import type {
  AdapterCapabilities,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage
} from "@cherryapi/shared";
import { eq } from "drizzle-orm";
import { GatewayError, toSafeErrorMessage } from "../core/errors";
import { fetchWithAccountProxy } from "../core/proxy-fetch";
import { db } from "../database/client";
import { accounts, type AccountRecord, type ChannelRecord } from "../database/schema";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import { env } from "../utils/env";
import { createId } from "../utils/id";
import type {
  AccountQuotaMetric,
  AccountQuotaSnapshot,
  AdapterContext,
  AdapterDetectionContext,
  DetectedModel,
  ModelTestResult,
  ProviderAdapter,
  UpstreamRequest,
  UpstreamResponse
} from "./types";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_TOKEN_REFRESH_TIMEOUT_MS = 15_000;
const CODEX_TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
const DEFAULT_INSTRUCTIONS = "You are a concise assistant.";
const CODEX_USER_AGENT = "codex-tui/0.118.0 (CherryAPI; codex-adapter)";
const CODEX_ORIGINATOR = "codex-tui";

type CodexContentPart = {
  type: "input_text" | "output_text";
  text: string;
};

type CodexInputItem = {
  role: string;
  content: CodexContentPart[];
};

interface CodexCredential {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  chatgptAccountId: string | null;
  expiresAt: string | null;
  rawJson: Record<string, unknown> | null;
}

interface CodexCredentialParseOptions {
  allowExpired?: boolean;
}

interface CodexTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface ParsedSseEvent {
  event: string | null;
  data: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function debugLog(message: string, payload: Record<string, unknown>): void {
  if (env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug(`[CodexAdapter] ${message}`, payload);
  }
}

function errorLog(message: string, payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[CodexAdapter] ${message}`, payload);
}

function trimText(text: string, length = 1000): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) {
    return {};
  }
  const part = token.split(".")[1];
  if (!part) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractChatGptAccountIdFromToken(token?: string): string | null {
  const payload = decodeJwtPayload(token);
  const authClaim = payload["https://api.openai.com/auth"];
  if (authClaim && typeof authClaim === "object") {
    const claim = authClaim as Record<string, unknown>;
    return optionalString(claim.chatgpt_account_id) ?? optionalString(claim.account_id);
  }
  return null;
}

export function parseCodexCredential(
  credential: string,
  options: CodexCredentialParseOptions = {}
): CodexCredential {
  const trimmed = credential.trim();
  if (!trimmed) {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex credential is empty", 401);
  }

  if (!trimmed.startsWith("{")) {
    return {
      accessToken: trimmed,
      refreshToken: null,
      idToken: null,
      chatgptAccountId: extractChatGptAccountIdFromToken(trimmed),
      expiresAt: null,
      rawJson: null
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(value)) {
      throw new Error("credential JSON must be an object");
    }
    parsed = value;
  } catch (error) {
    throw new GatewayError("CODEX_AUTH_ERROR", `Invalid Codex credential JSON: ${toSafeErrorMessage(error)}`, 401);
  }

  const accessToken = optionalString(parsed.access_token ?? parsed.accessToken ?? parsed.token);
  if (!accessToken) {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex credential JSON must include access_token", 401);
  }

  const expiresAt = optionalString(parsed.expired_at ?? parsed.expired ?? parsed.expires_at ?? parsed.expiresAt);
  if (expiresAt) {
    const expires = Date.parse(expiresAt);
    if (!options.allowExpired && Number.isFinite(expires) && expires <= Date.now()) {
      throw new GatewayError("CODEX_AUTH_ERROR", "Codex access token is expired", 401);
    }
  }

  return {
    accessToken,
    refreshToken: optionalString(parsed.refresh_token ?? parsed.refreshToken),
    idToken: optionalString(parsed.id_token ?? parsed.idToken),
    chatgptAccountId:
      optionalString(parsed.chatgpt_account_id ?? parsed.chatgptAccountId ?? parsed.account_id ?? parsed.accountId) ??
      extractChatGptAccountIdFromToken(accessToken),
    expiresAt,
    rawJson: parsed
  };
}

function tokenExpiresAtMillis(credential: CodexCredential): number | null {
  if (!credential.expiresAt) {
    return null;
  }
  const expiresAt = Date.parse(credential.expiresAt);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function credentialIsExpired(credential: CodexCredential): boolean {
  const expiresAt = tokenExpiresAtMillis(credential);
  return expiresAt !== null && expiresAt <= Date.now();
}

function credentialExpiresSoon(credential: CodexCredential): boolean {
  const expiresAt = tokenExpiresAtMillis(credential);
  return expiresAt !== null && expiresAt <= Date.now() + CODEX_TOKEN_REFRESH_SKEW_MS;
}

function authClaimFromAccessToken(accessToken: string): Record<string, unknown> {
  const claim = decodeJwtPayload(accessToken)["https://api.openai.com/auth"];
  return claim && typeof claim === "object" && !Array.isArray(claim) ? (claim as Record<string, unknown>) : {};
}

function scopeList(scope: string | undefined, previous: unknown): string[] | unknown {
  if (scope) {
    return scope.split(/\s+/).filter(Boolean);
  }
  return previous;
}

function refreshedCredentialJson(tokens: CodexTokenResponse, previous: CodexCredential): string {
  const accessToken = optionalString(tokens.access_token);
  if (!accessToken) {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex OAuth refresh response did not include access_token", 401);
  }

  const raw = previous.rawJson ?? {};
  const idToken = optionalString(tokens.id_token) ?? previous.idToken;
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken ?? undefined);
  const auth = authClaimFromAccessToken(accessToken);
  const expiresIn =
    typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : undefined;
  const exp = typeof accessPayload.exp === "number" ? new Date(accessPayload.exp * 1000).toISOString() : expiresIn ?? previous.expiresAt ?? undefined;
  const email = optionalString(idPayload.email ?? accessPayload.email ?? raw.email);
  const chatgptAccountId =
    optionalString(auth.chatgpt_account_id ?? auth.account_id) ??
    previous.chatgptAccountId ??
    optionalString(raw.chatgpt_account_id ?? raw.chatgptAccountId);
  const accountId = optionalString(accessPayload.sub ?? idPayload.sub ?? raw.account_id ?? raw.accountId);

  return JSON.stringify({
    ...raw,
    type: "codex_oauth",
    id_token: idToken,
    access_token: accessToken,
    refresh_token: optionalString(tokens.refresh_token) ?? previous.refreshToken,
    expired: false,
    expired_at: exp,
    expires_at: exp,
    email,
    account_id: accountId,
    chatgpt_account_id: chatgptAccountId,
    scopes: scopeList(tokens.scope, raw.scopes),
    updated_at: new Date().toISOString()
  });
}

async function refreshCodexCredential(account: AccountRecord, credential: CodexCredential): Promise<CodexCredential> {
  if (!credential.refreshToken) {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex access token is expired and no refresh_token is available", 401);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    client_id: CODEX_CLIENT_ID
  });
  const response = await fetchWithAccountProxy(CODEX_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(CODEX_TOKEN_REFRESH_TIMEOUT_MS)
  }, account);
  const text = await response.text().catch(() => "");

  if (!response.ok) {
    throw new GatewayError("CODEX_AUTH_ERROR", `Codex OAuth token refresh failed (HTTP ${response.status}: ${trimText(text)})`, 401);
  }

  let tokens: CodexTokenResponse;
  try {
    tokens = JSON.parse(text) as CodexTokenResponse;
  } catch {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex OAuth token refresh returned invalid JSON", 401);
  }

  const refreshedRaw = refreshedCredentialJson(tokens, credential);
  await db
    .update(accounts)
    .set({
      credentialEncrypted: encryptSecret(refreshedRaw),
      updatedAt: new Date().toISOString()
    })
    .where(eq(accounts.id, account.id));
  return parseCodexCredential(refreshedRaw);
}

async function codexCredentialForAccount(account: AccountRecord): Promise<CodexCredential> {
  const rawCredential = decryptSecret(account.credentialEncrypted);
  const credential = parseCodexCredential(rawCredential, { allowExpired: true });
  if (!credentialExpiresSoon(credential)) {
    return credential;
  }
  if (!credential.refreshToken) {
    return parseCodexCredential(rawCredential);
  }

  try {
    return await refreshCodexCredential(account, credential);
  } catch (error) {
    if (!credentialIsExpired(credential)) {
      return credential;
    }
    throw error;
  }
}

export function codexResponsesUrl(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) {
    return trimmed;
  }
  return `${trimmed}/responses`;
}

function messageText(message: OpenAIChatMessage): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (content === null) {
    return "";
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const record = part as Record<string, unknown>;
      return optionalString(record.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function codexRole(role: OpenAIChatMessage["role"]): string {
  if (role === "assistant") {
    return "assistant";
  }
  return "user";
}

function codexContentType(role: OpenAIChatMessage["role"]): "input_text" | "output_text" {
  return role === "assistant" ? "output_text" : "input_text";
}

function buildCodexInput(messages: OpenAIChatMessage[]): CodexInputItem[] {
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = messageText(message);
      return {
        role: codexRole(message.role),
        content: text ? [{ type: codexContentType(message.role), text }] : []
      };
    })
    .filter((item) => item.content.length > 0);

  if (input.length === 0) {
    return [{ role: "user", content: [{ type: "input_text", text: "ping" }] }];
  }
  return input;
}

function buildInstructions(input: OpenAIChatCompletionRequest): string {
  const explicit = optionalString(input.instructions);
  if (explicit) {
    return explicit;
  }

  const systemMessages = input.messages
    .filter((message) => message.role === "system")
    .map(messageText)
    .filter(Boolean);
  return systemMessages.length ? systemMessages.join("\n\n") : DEFAULT_INSTRUCTIONS;
}

export function buildCodexResponsesBody(
  input: OpenAIChatCompletionRequest,
  upstreamModelName: string
): Record<string, unknown> {
  return {
    model: upstreamModelName,
    instructions: buildInstructions(input),
    input: buildCodexInput(input.messages),
    store: false,
    stream: true
  };
}

export function stringifyCodexBody(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

export function buildCodexHeaders(credential: CodexCredential): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": CODEX_USER_AGENT,
    originator: CODEX_ORIGINATOR,
    connection: "Keep-Alive"
  };
  if (credential.chatgptAccountId) {
    headers["chatgpt-account-id"] = credential.chatgptAccountId;
  }
  return headers;
}

function buildCodexJsonHeaders(credential: CodexCredential): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: "application/json",
    "User-Agent": CODEX_USER_AGENT,
    originator: CODEX_ORIGINATOR,
    connection: "Keep-Alive"
  };
  if (credential.chatgptAccountId) {
    headers["chatgpt-account-id"] = credential.chatgptAccountId;
  }
  return headers;
}

export function buildSanitizedCodexHeaders(hasChatGptAccountId: boolean): Record<string, string> {
  return {
    Authorization: "[redacted]",
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": CODEX_USER_AGENT,
    originator: CODEX_ORIGINATOR,
    connection: "Keep-Alive",
    ...(hasChatGptAccountId ? { "chatgpt-account-id": "[redacted]" } : {})
  };
}

function codexBaseUrl(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) {
    return trimmed.slice(0, -"/responses".length);
  }
  return trimmed;
}

function codexModelListUrls(baseUrl: string | null): string[] {
  const base = codexBaseUrl(baseUrl);
  const root = "https://chatgpt.com/backend-api";
  return [
    `${base}/models`,
    `${base}/v1/models`,
    `${base}/model`,
    `${root}/codex/models`,
    `${root}/codex/v1/models`,
    `${root}/models`
  ].filter((url, index, all) => all.indexOf(url) === index);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function unixSecondsToIso(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  const millis = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function codexWindowLabel(minutes: number | null, fallback: string): string {
  if (!minutes || minutes <= 0) {
    return fallback;
  }
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return days === 7 ? "Weekly" : `${days}d`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

function codexWindowMetric(id: string, fallbackLabel: string, value: unknown): AccountQuotaMetric | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const usedPercent = clampPercent(numberValue(value.used_percent) ?? 0);
  const remainingPercent = clampPercent(100 - usedPercent);
  const windowSeconds = numberValue(value.limit_window_seconds);
  const windowMinutes = windowSeconds && windowSeconds > 0 ? Math.ceil(windowSeconds / 60) : null;
  const resetAfterSeconds = numberValue(value.reset_after_seconds);
  const resetAtSeconds =
    numberValue(value.reset_at) ??
    (resetAfterSeconds !== null && resetAfterSeconds >= 0 ? Math.floor(Date.now() / 1000) + resetAfterSeconds : null);

  return {
    id,
    label: codexWindowLabel(windowMinutes, fallbackLabel),
    usedPercent,
    remainingPercent,
    resetAt: unixSecondsToIso(resetAtSeconds),
    raw: value
  };
}

function quotaSummary(metrics: AccountQuotaMetric[]): AccountQuotaSnapshot["summary"] {
  const usedPercents = metrics
    .map((metric) => metric.usedPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (usedPercents.length === 0) {
    return {};
  }
  const usedPercent = clampPercent(usedPercents.reduce((sum, value) => sum + value, 0) / usedPercents.length);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent)
  };
}

function modelIdFromValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!isPlainObject(value)) {
    return null;
  }
  const id = value.id ?? value.name ?? value.model ?? value.slug ?? value.model_slug;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

const CODEX_MODEL_SLUG_ALIASES = new Map<string, string>([
  ["gpt-5-5", "gpt-5.5"],
  ["gpt-5-5-instant", "gpt-5.5"],
  ["gpt-5-5-thinking", "gpt-5.5"],
  ["gpt-5-5-pro", "gpt-5.5"],
  ["gpt-5-4", "gpt-5.4"],
  ["gpt-5-4-thinking", "gpt-5.4"],
  ["gpt-5-4-pro", "gpt-5.4"],
  ["gpt-5-4-mini", "gpt-5.4-mini"],
  ["gpt-5-4-t-mini", "gpt-5.4-mini"],
  ["gpt-5-3", "gpt-5.3-codex"],
  ["gpt-5-3-instant", "gpt-5.3-codex"],
  ["gpt-5-3-mini", "gpt-5.3-codex"],
  ["gpt-5-2", "gpt-5.2"],
  ["gpt-5-2-instant", "gpt-5.2"],
  ["gpt-5-2-thinking", "gpt-5.2"],
  ["gpt-5-2-pro", "gpt-5.2"]
]);

function normalizeCodexListModelId(rawId: string): string | null {
  const id = rawId.trim();
  if (!id) {
    return null;
  }

  if (id.includes(".")) {
    return id;
  }

  return CODEX_MODEL_SLUG_ALIASES.get(id) ?? null;
}

function modelArrayFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isPlainObject(payload)) {
    return [];
  }
  const candidates = [
    payload.data,
    payload.models,
    payload.items,
    payload.available_models,
    payload.availableModels,
    payload.model_slugs
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function parseCodexModelList(payload: unknown): DetectedModel[] {
  const byModel = new Map<string, DetectedModel>();
  for (const item of modelArrayFromPayload(payload)) {
    const rawId = modelIdFromValue(item);
    if (!rawId) {
      continue;
    }
    const normalizedId = normalizeCodexListModelId(rawId);
    if (!normalizedId) {
      continue;
    }

    const existing = byModel.get(normalizedId);
    const sourceIds = Array.isArray(existing?.capabilities?.sourceIds)
      ? [...existing.capabilities.sourceIds, rawId]
      : [rawId];
    byModel.set(normalizedId, {
      upstreamModelName: normalizedId,
      displayName: normalizedId,
      capabilities: {
        ...codexCapabilityRecord(),
        sourceIds: [...new Set(sourceIds)],
        normalizedFrom: rawId === normalizedId ? undefined : rawId
      },
      source: "upstream_list"
    });
  }

  return [...byModel.values()];
}

async function codexUpstreamError(response: Response, context: AdapterContext): Promise<GatewayError> {
  const text = trimText(await response.text().catch(() => ""));
  const code =
    response.status === 401 || response.status === 403
      ? "CODEX_AUTH_ERROR"
      : response.status === 404 && /model|not found/i.test(text)
        ? "CODEX_MODEL_NOT_AVAILABLE"
        : "CODEX_UPSTREAM_ERROR";
  errorLog("upstream non-2xx response", {
    requestId: context.requestId,
    status: response.status,
    requestModel: context.model.publicName,
    upstreamModel: context.upstreamModelName,
    responseText: text
  });
  return new GatewayError(code, text || `Codex upstream returned HTTP ${response.status}`, code === "CODEX_AUTH_ERROR" ? 401 : 502);
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join("\n") };
}

async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseSseBlock(buffer);
    if (event) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseJsonData(data: string): Record<string, unknown> | null {
  if (!data || data === "[DONE]") {
    return null;
  }
  try {
    const value = JSON.parse(data) as unknown;
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function extractTextFromResponseValue(value: unknown): string {
  if (!isPlainObject(value)) {
    return "";
  }

  if (typeof value.output_text === "string") {
    return value.output_text;
  }

  const output = Array.isArray(value.output) ? value.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!isPlainObject(item)) {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (isPlainObject(part) && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

function extractUsageFromValue(value: unknown): OpenAIUsage | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const usage = isPlainObject(value.usage)
    ? value.usage
    : isPlainObject(value.response) && isPlainObject(value.response.usage)
      ? value.response.usage
      : undefined;
  if (!usage) {
    return undefined;
  }

  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? prompt + completion);
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : 0,
    completion_tokens: Number.isFinite(completion) ? completion : 0,
    total_tokens: Number.isFinite(total) ? total : 0
  };
}

function extractDelta(value: Record<string, unknown>, eventType: string): string {
  if (
    (eventType === "response.output_text.delta" || eventType === "response.refusal.delta") &&
    typeof value.delta === "string"
  ) {
    return value.delta;
  }

  if (typeof value.delta === "string") {
    return value.delta;
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0];
  if (isPlainObject(first) && isPlainObject(first.delta) && typeof first.delta.content === "string") {
    return first.delta.content;
  }

  return "";
}

function extractErrorMessage(value: Record<string, unknown>, eventType: string): string | null {
  if (!eventType.includes("error") && !value.error) {
    return null;
  }

  if (typeof value.error === "string") {
    return value.error;
  }
  if (isPlainObject(value.error)) {
    return optionalString(value.error.message) ?? JSON.stringify(value.error);
  }
  return optionalString(value.message) ?? `Codex stream emitted ${eventType}`;
}

function isDoneEvent(eventType: string): boolean {
  return eventType === "response.completed" || eventType === "response.done" || eventType === "done";
}

function extractResponseText(upstreamText: string): string {
  let content = "";
  for (const block of upstreamText.split(/\r?\n\r?\n/)) {
    const event = parseSseBlock(block);
    if (!event) {
      continue;
    }
    const value = parseJsonData(event.data);
    if (!value) {
      continue;
    }
    const eventType = String(value.type ?? event.event ?? "");
    content += extractDelta(value, eventType);
    if (!content && isDoneEvent(eventType)) {
      content = extractTextFromResponseValue(value.response ?? value);
    }
  }

  if (content) {
    return content;
  }

  try {
    return extractTextFromResponseValue(JSON.parse(upstreamText) as unknown);
  } catch {
    return upstreamText;
  }
}

function extractUsageFromText(upstreamText: string): OpenAIUsage {
  for (const block of upstreamText.split(/\r?\n\r?\n/).reverse()) {
    const event = parseSseBlock(block);
    if (!event) {
      continue;
    }
    const value = parseJsonData(event.data);
    const usage = extractUsageFromValue(value);
    if (usage) {
      return usage;
    }
  }

  try {
    return extractUsageFromValue(JSON.parse(upstreamText) as unknown) ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  } catch {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }
}

function extractErrorFromText(upstreamText: string): string | null {
  for (const block of upstreamText.split(/\r?\n\r?\n/)) {
    const event = parseSseBlock(block);
    if (!event) {
      continue;
    }
    const value = parseJsonData(event.data);
    if (!value) {
      continue;
    }
    const message = extractErrorMessage(value, String(value.type ?? event.event ?? ""));
    if (message) {
      return trimText(message);
    }
  }
  return null;
}

function codexCapabilities(): AdapterCapabilities {
  return {
    chatCompletions: true,
    streaming: true,
    tools: false,
    responses: true
  };
}

function codexCapabilityRecord(): Record<string, unknown> {
  return { ...codexCapabilities() };
}

function codexDetectionCapabilities(ok: boolean, check: Record<string, unknown>): Record<string, unknown> {
  return {
    ...codexCapabilities(),
    chatCompletions: ok,
    streaming: ok,
    responses: ok,
    checks: {
      chatCompletions: { ...check, via: "codex_responses" },
      streaming: { ...check, via: "codex_responses" },
      responses: check
    }
  };
}

export class CodexAdapter implements ProviderAdapter {
  type = "codex";

  getCapabilities(): AdapterCapabilities {
    return codexCapabilities();
  }

  async transformRequest(input: OpenAIChatCompletionRequest, context: AdapterContext): Promise<UpstreamRequest> {
    const body = buildCodexResponsesBody(input, context.upstreamModelName);
    const bodyJson = stringifyCodexBody(body);
    const url = codexResponsesUrl(context.channel.baseUrl);

    debugLog("prepared upstream request", {
      requestId: context.requestId,
      upstreamUrl: url,
      requestModel: input.model,
      upstreamModel: context.upstreamModelName,
      clientStream: context.stream,
      upstreamStream: true,
      upstreamBody: body
    });

    return {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": CODEX_USER_AGENT,
        originator: CODEX_ORIGINATOR,
        connection: "Keep-Alive"
      },
      body,
      bodyJson,
      stream: true
    };
  }

  async send(request: UpstreamRequest, account: AccountRecord, context: AdapterContext): Promise<UpstreamResponse> {
    const credential = await codexCredentialForAccount(account);
    const response = await fetchWithAccountProxy(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        ...buildCodexHeaders(credential)
      },
      body: request.bodyJson
    }, account);

    if (!response.ok) {
      throw await codexUpstreamError(response, context);
    }

    return {
      status: response.status,
      headers: response.headers,
      raw: response
    };
  }

  async transformResponse(response: UpstreamResponse, context: AdapterContext): Promise<OpenAIChatCompletionResponse> {
    const upstreamText = await response.raw.text();
    const streamError = extractErrorFromText(upstreamText);
    if (streamError) {
      throw new GatewayError("CODEX_STREAM_ERROR", streamError, 502);
    }

    const content = extractResponseText(upstreamText);
    const usage = extractUsageFromText(upstreamText);
    return {
      id: createId("chatcmpl"),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: context.model.publicName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content
          },
          finish_reason: "stop"
        }
      ],
      usage
    };
  }

  async *transformStream(response: UpstreamResponse, context: AdapterContext): AsyncIterable<OpenAIChatCompletionChunk> {
    if (!response.raw.body) {
      throw new GatewayError("CODEX_STREAM_ERROR", "Codex upstream response did not include a stream body", 502);
    }

    const id = createId("chatcmpl");
    const created = Math.floor(Date.now() / 1000);
    let sawTextDelta = false;
    let finished = false;
    let usage: OpenAIUsage | undefined;

    for await (const event of readSseEvents(response.raw.body)) {
      const value = parseJsonData(event.data);
      if (!value) {
        continue;
      }

      const eventType = String(value.type ?? event.event ?? "");
      const error = extractErrorMessage(value, eventType);
      if (error) {
        throw new GatewayError("CODEX_STREAM_ERROR", trimText(error), 502);
      }

      const nextUsage = extractUsageFromValue(value);
      if (nextUsage) {
        usage = nextUsage;
      }

      const delta = extractDelta(value, eventType);
      if (delta) {
        sawTextDelta = true;
        yield {
          id,
          object: "chat.completion.chunk",
          created,
          model: context.model.publicName,
          choices: [
            {
              index: 0,
              delta: { content: delta },
              finish_reason: null
            }
          ],
          usage: null
        };
        continue;
      }

      if (isDoneEvent(eventType)) {
        const finalText = sawTextDelta ? "" : extractTextFromResponseValue(value.response ?? value);
        if (finalText) {
          yield {
            id,
            object: "chat.completion.chunk",
            created,
            model: context.model.publicName,
            choices: [
              {
                index: 0,
                delta: { content: finalText },
                finish_reason: null
              }
            ],
            usage: null
          };
        }
        yield {
          id,
          object: "chat.completion.chunk",
          created,
          model: context.model.publicName,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop"
            }
          ],
          usage: usage ?? null
        };
        finished = true;
        return;
      }

      if (eventType) {
        debugLog("ignored upstream stream event", {
          requestId: context.requestId,
          eventType
        });
      }
    }

    if (!finished) {
      yield {
        id,
        object: "chat.completion.chunk",
        created,
        model: context.model.publicName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop"
          }
        ],
        usage: usage ?? null
      };
    }
  }

  async checkQuota(
    account: AccountRecord,
    _channel: ChannelRecord,
    _context: AdapterDetectionContext
  ): Promise<AccountQuotaSnapshot> {
    const credential = await codexCredentialForAccount(account);
    const headers = buildCodexJsonHeaders(credential);
    if (credential.chatgptAccountId) {
      headers["ChatGPT-Account-Id"] = credential.chatgptAccountId;
    }

    const response = await fetchWithAccountProxy(CODEX_USAGE_URL, {
      method: "GET",
      headers
    }, account);
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      throw new GatewayError("CODEX_UPSTREAM_ERROR", `Codex quota API returned HTTP ${response.status}: ${trimText(text)}`, 502);
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new GatewayError("CODEX_UPSTREAM_ERROR", "Codex quota API returned invalid JSON", 502);
    }

    if (!isPlainObject(data)) {
      throw new GatewayError("CODEX_UPSTREAM_ERROR", "Codex quota API returned an unexpected response", 502);
    }

    const rateLimit = isPlainObject(data.rate_limit) ? data.rate_limit : null;
    const metrics = [
      codexWindowMetric("primary", "5h", rateLimit?.primary_window),
      codexWindowMetric("secondary", "Weekly", rateLimit?.secondary_window)
    ].filter((metric): metric is AccountQuotaMetric => Boolean(metric));

    if (metrics.length === 0 && rateLimit) {
      const usedPercent = rateLimit.limit_reached === true ? 100 : 0;
      metrics.push({
        id: "overall",
        label: "Codex Usage",
        usedPercent,
        remainingPercent: 100 - usedPercent,
        included: rateLimit.allowed !== false,
        raw: rateLimit
      });
    }

    return {
      provider: "codex",
      checkedAt: new Date().toISOString(),
      plan: optionalString(data.plan_type),
      metrics,
      summary: quotaSummary(metrics),
      raw: data
    };
  }

  async listModels(
    account: AccountRecord,
    channel: ChannelRecord,
    _context: AdapterDetectionContext
  ): Promise<DetectedModel[]> {
    const credential = await codexCredentialForAccount(account);
    const errors: string[] = [];

    for (const url of codexModelListUrls(channel.baseUrl)) {
      let response: Response;
      let text: string;
      try {
        response = await fetchWithAccountProxy(url, {
          method: "GET",
          headers: buildCodexJsonHeaders(credential)
        }, account);
        text = await response.text().catch(() => "");
        if (!response.ok) {
          errors.push(`${url} -> HTTP ${response.status}: ${trimText(text, 300)}`);
          continue;
        }
      } catch (error) {
        errors.push(`${url} -> ${trimText(toSafeErrorMessage(error), 300)}`);
        continue;
      }

      try {
        const models = parseCodexModelList(JSON.parse(text) as unknown);
        if (models.length > 0) {
          return models;
        }
        errors.push(`${url} -> no usable model list in response`);
      } catch {
        errors.push(`${url} -> non-JSON response: ${trimText(text, 300)}`);
      }
    }

    throw new GatewayError(
      "CODEX_UPSTREAM_ERROR",
      `Codex upstream model-list API did not return a usable model list. ${errors.join(" | ")}`,
      502
    );
  }

  async testModel(
    account: AccountRecord,
    channel: ChannelRecord,
    upstreamModelName: string,
    _context: AdapterDetectionContext
  ): Promise<ModelTestResult> {
    const startedAt = Date.now();
    const url = codexResponsesUrl(channel.baseUrl);
    try {
      const credential = await codexCredentialForAccount(account);
      const body = buildCodexResponsesBody(
        {
          model: upstreamModelName,
          stream: false,
          messages: [{ role: "user", content: "ping" }]
        },
        upstreamModelName
      );
      const response = await fetchWithAccountProxy(url, {
        method: "POST",
        headers: buildCodexHeaders(credential),
        body: stringifyCodexBody(body)
      }, account);
      const text = await response.text().catch(() => "");
      const latencyMs = Date.now() - startedAt;
      const baseCheck = {
        endpoint: "responses",
        url,
        status: response.status,
        latencyMs
      };

      if (!response.ok) {
        const error = trimText(text || `Codex upstream returned HTTP ${response.status}`);
        return {
          status: "unavailable",
          latencyMs,
          capabilities: codexDetectionCapabilities(false, { ...baseCheck, ok: false, error }),
          error
        };
      }

      const streamError = extractErrorFromText(text);
      if (streamError) {
        return {
          status: "unavailable",
          latencyMs,
          capabilities: codexDetectionCapabilities(false, { ...baseCheck, ok: false, error: streamError }),
          error: streamError
        };
      }

      return {
        status: "available",
        latencyMs,
        capabilities: codexDetectionCapabilities(true, { ...baseCheck, ok: true, error: null }),
        error: null
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = trimText(toSafeErrorMessage(error));
      return {
        status: "unavailable",
        latencyMs,
        capabilities: codexDetectionCapabilities(false, {
          endpoint: "responses",
          url,
          status: null,
          latencyMs,
          ok: false,
          error: message
        }),
        error: message
      };
    }
  }
}
