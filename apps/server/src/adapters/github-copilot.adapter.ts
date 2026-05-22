import { randomUUID } from "node:crypto";
import type {
  AdapterCapabilities,
  OpenAIChatCompletionRequest
} from "@cherryapi/shared";
import { GatewayError, toSafeErrorMessage } from "../core/errors";
import { fetchWithAccountProxy, fetchWithProxy } from "../core/proxy-fetch";
import type { AccountRecord, ChannelRecord } from "../database/schema";
import { decryptSecret } from "../utils/crypto";
import type {
  AccountQuotaMetric,
  AccountQuotaSnapshot,
  AdapterContext,
  AdapterDetectionContext,
  DetectedModel,
  ModelTestResult,
  UpstreamRequest,
  UpstreamResponse
} from "./types";
import {
  buildOpenAICompatibleUpstreamBody,
  OpenAICompatibleAdapter,
  stringifyUpstreamBody
} from "./openai-compatible.adapter";

const DEFAULT_COPILOT_BASE_URL = "https://api.githubcopilot.com";
const GITHUB_USER_ENDPOINT = "https://api.github.com/user";
const GITHUB_USER_EMAILS_ENDPOINT = "https://api.github.com/user/emails";
const GITHUB_COPILOT_TOKEN_ENDPOINT = "https://api.github.com/copilot_internal/v2/token";
const GITHUB_COPILOT_USER_INFO_ENDPOINT = "https://api.github.com/copilot_internal/user";
const APP_USER_AGENT = "CherryAPI GitHubCopilot";
const GITHUB_API_VERSION = process.env.GITHUB_API_VERSION ?? "2022-11-28";

interface GitHubUser {
  id?: number;
  login?: string;
  name?: string | null;
  email?: string | null;
}

interface GitHubEmail {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

interface CopilotTokenResponse {
  token?: string;
  expires_at?: number;
  refresh_in?: number;
  sku?: string;
  chat_enabled?: boolean;
  limited_user_quotas?: unknown;
  limited_user_reset_date?: number;
  message?: string;
}

interface CopilotUserInfoResponse {
  copilot_plan?: string;
  quota_snapshots?: unknown;
  quota_reset_date?: string;
}

export interface GitHubCopilotCredential {
  type: "github_copilot";
  github_access_token?: string;
  github_token_type?: string | null;
  github_scope?: string | null;
  github_id?: number | string;
  github_login?: string;
  github_name?: string | null;
  github_email?: string | null;
  copilot_token?: string;
  copilot_plan?: string | null;
  copilot_chat_enabled?: boolean | null;
  copilot_expires_at?: number | string | null;
  copilot_refresh_in?: number | null;
  copilot_quota_snapshots?: unknown;
  copilot_quota_reset_date?: string | null;
  copilot_limited_user_quotas?: unknown;
  copilot_limited_user_reset_date?: number | null;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

interface CopilotTokenBundle {
  token: string;
  plan?: string | null;
  chatEnabled?: boolean | null;
  expiresAt?: number | null;
  refreshIn?: number | null;
  quotaSnapshots?: unknown;
  quotaResetDate?: string | null;
  limitedUserQuotas?: unknown;
  limitedUserResetDate?: number | null;
}

interface CopilotProbeCheck {
  ok: boolean;
  endpoint: "chat" | "stream";
  url: string;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

function trimText(text: string, length = 1000): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | null {
  return optionalNumber(value) ?? null;
}

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function parseTokenMap(token: string): Record<string, string> {
  const map: Record<string, string> = {};
  const prefix = token.split(":")[0] ?? token;
  for (const part of prefix.split(";")) {
    const [rawKey, rawValue = ""] = part.split("=");
    const key = rawKey.trim();
    if (key) {
      map[key] = rawValue.trim();
    }
  }
  return map;
}

function unixSecondsToIso(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  const millis = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDateLikeToIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function pickCopilotResetAt(
  limitedUserResetDate: number | null | undefined,
  quotaResetDate: string | null | undefined,
  tokenMap: Record<string, string>
): string | null {
  const limitedReset = finiteNumber(limitedUserResetDate);
  if (limitedReset !== null) {
    return unixSecondsToIso(limitedReset);
  }

  const resetDate = parseDateLikeToIso(quotaResetDate);
  if (resetDate) {
    return resetDate;
  }

  const tokenReset = finiteNumber(tokenMap.rd?.split(":")[0]);
  return unixSecondsToIso(tokenReset);
}

function quotaObject(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function quotaSnapshotMetric(
  id: string,
  label: string,
  snapshot: Record<string, unknown> | null,
  resetAt: string | null
): AccountQuotaMetric | null {
  if (!snapshot) {
    return null;
  }

  const entitlement = finiteNumber(snapshot.entitlement);
  const included = snapshot.unlimited === true || (entitlement !== null && entitlement < 0);
  const limit = entitlement !== null && entitlement > 0 ? entitlement : null;
  const remainingPercent = included
    ? 100
    : finiteNumber(snapshot.percent_remaining) !== null
      ? clampPercent(finiteNumber(snapshot.percent_remaining) ?? 0)
      : null;
  const remaining =
    finiteNumber(snapshot.remaining) ??
    (limit !== null && remainingPercent !== null ? Math.max(0, Math.round((limit * remainingPercent) / 100)) : null);
  const used = limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null;
  const usedPercent =
    included
      ? 0
      : remainingPercent !== null
        ? clampPercent(100 - remainingPercent)
        : limit !== null && used !== null
          ? clampPercent((used / limit) * 100)
          : null;

  return {
    id,
    label,
    used,
    limit,
    remaining,
    usedPercent,
    remainingPercent,
    resetAt,
    included,
    unlimited: snapshot.unlimited === true,
    raw: snapshot
  };
}

function limitedQuotaMetric(
  id: string,
  label: string,
  remaining: number | null,
  total: number | null,
  resetAt: string | null,
  raw: unknown
): AccountQuotaMetric | null {
  if (remaining === null && total === null) {
    return null;
  }

  const limit = total ?? remaining;
  const used = limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null;
  const usedPercent = limit !== null && limit > 0 && used !== null ? clampPercent((used / limit) * 100) : null;

  return {
    id,
    label,
    used,
    limit,
    remaining,
    usedPercent,
    remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
    resetAt,
    raw
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

function parseCredentialJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim().startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub Copilot credential JSON is invalid", 401);
  }
}

export function parseGitHubCopilotCredential(rawCredential: string): GitHubCopilotCredential {
  const raw = rawCredential.trim();
  if (!raw) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub Copilot credential is empty", 401);
  }

  const json = parseCredentialJson(raw);
  if (!json) {
    return {
      type: "github_copilot",
      copilot_token: raw
    };
  }

  const credential: GitHubCopilotCredential = {
    type: "github_copilot",
    github_access_token: optionalString(json.github_access_token ?? json.githubAccessToken),
    github_token_type: optionalString(json.github_token_type ?? json.githubTokenType) ?? null,
    github_scope: optionalString(json.github_scope ?? json.githubScope) ?? null,
    github_id: optionalString(json.github_id ?? json.githubId) ?? optionalNumber(json.github_id ?? json.githubId),
    github_login: optionalString(json.github_login ?? json.githubLogin ?? json.login),
    github_name: optionalString(json.github_name ?? json.githubName ?? json.name) ?? null,
    github_email: optionalString(json.github_email ?? json.githubEmail ?? json.email) ?? null,
    copilot_token: optionalString(json.copilot_token ?? json.copilotToken ?? json.token ?? json.access_token),
    copilot_plan: optionalString(json.copilot_plan ?? json.copilotPlan ?? json.sku) ?? null,
    copilot_chat_enabled:
      typeof (json.copilot_chat_enabled ?? json.copilotChatEnabled) === "boolean"
        ? (json.copilot_chat_enabled ?? json.copilotChatEnabled) as boolean
        : null,
    copilot_expires_at: optionalNumber(json.copilot_expires_at ?? json.copilotExpiresAt ?? json.expires_at ?? json.expiresAt) ?? null,
    copilot_refresh_in: optionalNumber(json.copilot_refresh_in ?? json.copilotRefreshIn) ?? null,
    copilot_quota_snapshots: json.copilot_quota_snapshots ?? json.copilotQuotaSnapshots,
    copilot_quota_reset_date: optionalString(json.copilot_quota_reset_date ?? json.copilotQuotaResetDate) ?? null,
    copilot_limited_user_quotas: json.copilot_limited_user_quotas ?? json.copilotLimitedUserQuotas,
    copilot_limited_user_reset_date: optionalNumber(json.copilot_limited_user_reset_date ?? json.copilotLimitedUserResetDate) ?? null,
    source: optionalString(json.source),
    created_at: optionalString(json.created_at ?? json.createdAt)
  };

  if (!credential.copilot_token && !credential.github_access_token) {
    throw new GatewayError(
      "GITHUB_COPILOT_AUTH_ERROR",
      "GitHub Copilot credential JSON must include copilot_token or github_access_token",
      401
    );
  }
  return credential;
}

function copilotApiRoot(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? DEFAULT_COPILOT_BASE_URL).replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.slice(0, -"/chat/completions".length);
  }
  if (trimmed.endsWith("/models")) {
    return trimmed.slice(0, -"/models".length);
  }
  return trimmed;
}

function copilotChatCompletionsUrl(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? DEFAULT_COPILOT_BASE_URL).replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function copilotModelsUrl(baseUrl: string | null): string {
  return `${copilotApiRoot(baseUrl)}/models`;
}

function copilotHeaders(token: string, accept = "application/json"): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": "vscode/1.99.3",
    "Editor-Plugin-Version": "copilot-chat/0.27.0",
    "OpenAI-Intent": "conversation-panel",
    "User-Agent": APP_USER_AGENT,
    "X-Request-Id": randomUUID()
  };
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return trimText(text || `Upstream returned HTTP ${response.status}`);
}

async function githubJson<T>(url: string, token: string, bearer = true): Promise<T> {
  const response = await fetchWithProxy(url, {
    method: "GET",
    headers: {
      Accept: url.includes("/copilot_internal/") ? "application/json" : "application/vnd.github+json",
      Authorization: `${bearer ? "Bearer" : "token"} ${token}`,
      "User-Agent": APP_USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", `GitHub API returned HTTP ${response.status}: ${trimText(text)}`, 401);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub API returned invalid JSON", 401);
  }
}

async function fetchGitHubUser(githubAccessToken: string): Promise<GitHubUser> {
  return githubJson<GitHubUser>(GITHUB_USER_ENDPOINT, githubAccessToken, true);
}

async function fetchGitHubEmail(githubAccessToken: string): Promise<string | undefined> {
  const emails = await githubJson<GitHubEmail[]>(GITHUB_USER_EMAILS_ENDPOINT, githubAccessToken, true);
  const verified = emails.filter((email) => email.email && email.verified !== false);
  return verified.find((email) => email.primary)?.email ?? verified[0]?.email;
}

async function fetchCopilotUserInfo(githubAccessToken: string): Promise<CopilotUserInfoResponse | null> {
  try {
    return await githubJson<CopilotUserInfoResponse>(GITHUB_COPILOT_USER_INFO_ENDPOINT, githubAccessToken, false);
  } catch {
    return null;
  }
}

export async function fetchGitHubCopilotTokenBundle(githubAccessToken: string): Promise<CopilotTokenBundle> {
  const payload = await githubJson<CopilotTokenResponse>(GITHUB_COPILOT_TOKEN_ENDPOINT, githubAccessToken, false);
  if (!payload.token) {
    throw new GatewayError(
      "GITHUB_COPILOT_AUTH_ERROR",
      payload.message ?? "GitHub Copilot token response did not include token",
      401
    );
  }
  const userInfo = await fetchCopilotUserInfo(githubAccessToken);
  return {
    token: payload.token,
    plan: userInfo?.copilot_plan ?? payload.sku ?? null,
    chatEnabled: payload.chat_enabled ?? null,
    expiresAt: payload.expires_at ?? null,
    refreshIn: payload.refresh_in ?? null,
    quotaSnapshots: userInfo?.quota_snapshots,
    quotaResetDate: userInfo?.quota_reset_date ?? null,
    limitedUserQuotas: payload.limited_user_quotas,
    limitedUserResetDate: payload.limited_user_reset_date ?? null
  };
}

export async function buildGitHubCopilotCredentialFromAccessToken(githubAccessToken: string): Promise<string> {
  const user = await fetchGitHubUser(githubAccessToken);
  const email = user.email ?? await fetchGitHubEmail(githubAccessToken).catch(() => undefined);
  const copilot = await fetchGitHubCopilotTokenBundle(githubAccessToken);
  return JSON.stringify({
    type: "github_copilot",
    github_access_token: githubAccessToken,
    github_token_type: "Bearer",
    github_id: user.id,
    github_login: user.login,
    github_name: user.name ?? null,
    github_email: email ?? null,
    copilot_token: copilot.token,
    copilot_plan: copilot.plan ?? null,
    copilot_chat_enabled: copilot.chatEnabled ?? null,
    copilot_expires_at: copilot.expiresAt ?? null,
    copilot_refresh_in: copilot.refreshIn ?? null,
    copilot_quota_snapshots: copilot.quotaSnapshots,
    copilot_quota_reset_date: copilot.quotaResetDate ?? null,
    copilot_limited_user_quotas: copilot.limitedUserQuotas,
    copilot_limited_user_reset_date: copilot.limitedUserResetDate ?? null,
    source: "github_access_token",
    created_at: new Date().toISOString()
  });
}

export async function refreshGitHubCopilotCredential(rawCredential: string): Promise<string> {
  const credential = parseGitHubCopilotCredential(rawCredential);
  if (!credential.github_access_token) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub access token is required to refresh Copilot credential", 401);
  }
  const copilot = await fetchGitHubCopilotTokenBundle(credential.github_access_token);
  return JSON.stringify({
    ...credential,
    copilot_token: copilot.token,
    copilot_plan: copilot.plan ?? null,
    copilot_chat_enabled: copilot.chatEnabled ?? null,
    copilot_expires_at: copilot.expiresAt ?? null,
    copilot_refresh_in: copilot.refreshIn ?? null,
    copilot_quota_snapshots: copilot.quotaSnapshots,
    copilot_quota_reset_date: copilot.quotaResetDate ?? null,
    copilot_limited_user_quotas: copilot.limitedUserQuotas,
    copilot_limited_user_reset_date: copilot.limitedUserResetDate ?? null,
    updated_at: new Date().toISOString()
  });
}

async function copilotTokenForCredential(credential: GitHubCopilotCredential): Promise<string> {
  const expiresAt = optionalNumber(credential.copilot_expires_at);
  if (credential.copilot_token && (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 60)) {
    return credential.copilot_token;
  }
  if (credential.github_access_token) {
    return (await fetchGitHubCopilotTokenBundle(credential.github_access_token)).token;
  }
  if (credential.copilot_token) {
    return credential.copilot_token;
  }
  throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub Copilot credential does not contain a usable token", 401);
}

async function copilotTokenForAccount(account: AccountRecord): Promise<string> {
  return copilotTokenForCredential(parseGitHubCopilotCredential(decryptSecret(account.credentialEncrypted)));
}

function detectedCapabilities(channel: ChannelRecord): Record<string, unknown> {
  return {
    chatCompletions: true,
    streaming: true,
    tools: true,
    responses: false,
    ...(channel.capabilities ?? {})
  };
}

function modelDisplayName(model: unknown): string | undefined {
  if (typeof model === "string") {
    return model;
  }
  if (!model || typeof model !== "object") {
    return undefined;
  }
  const record = model as Record<string, unknown>;
  return optionalString(record.id ?? record.name ?? record.model);
}

async function probeCopilotModelEndpoint(
  account: AccountRecord,
  url: string,
  token: string,
  endpoint: CopilotProbeCheck["endpoint"],
  body: Record<string, unknown>,
  accept: string
): Promise<CopilotProbeCheck> {
  const startedAt = Date.now();
  try {
    const response = await fetchWithAccountProxy(url, {
      method: "POST",
      headers: copilotHeaders(token, accept),
      body: stringifyUpstreamBody(body)
    }, account);
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        endpoint,
        url,
        status: response.status,
        latencyMs,
        error: await responseText(response)
      };
    }
    await response.arrayBuffer().catch(() => undefined);
    return {
      ok: true,
      endpoint,
      url,
      status: response.status,
      latencyMs,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      url,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: toSafeErrorMessage(error)
    };
  }
}

function firstProbeError(checks: CopilotProbeCheck[]): string | null {
  return checks
    .map((check) => check.error)
    .find((error): error is string => Boolean(error)) ?? null;
}

export class GitHubCopilotAdapter extends OpenAICompatibleAdapter {
  type = "github_copilot";

  getCapabilities(): AdapterCapabilities {
    return {
      chatCompletions: true,
      streaming: true,
      tools: true,
      responses: false
    };
  }

  async transformRequest(input: OpenAIChatCompletionRequest, context: AdapterContext): Promise<UpstreamRequest> {
    const body = buildOpenAICompatibleUpstreamBody(input, context.upstreamModelName, context.stream);
    const bodyJson = stringifyUpstreamBody(body);
    return {
      url: copilotChatCompletionsUrl(context.channel.baseUrl),
      method: "POST",
      headers: copilotHeaders("", context.stream ? "text/event-stream" : "application/json"),
      body,
      bodyJson,
      stream: context.stream
    };
  }

  async send(request: UpstreamRequest, account: AccountRecord, _context: AdapterContext): Promise<UpstreamResponse> {
    const token = await copilotTokenForAccount(account);
    const response = await fetchWithAccountProxy(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${token}`
      },
      body: request.bodyJson
    }, account);

    if (!response.ok) {
      throw new GatewayError("GITHUB_COPILOT_UPSTREAM_ERROR", await responseText(response), 502);
    }

    return {
      status: response.status,
      headers: response.headers,
      raw: response
    };
  }

  async checkQuota(
    account: AccountRecord,
    _channel: ChannelRecord,
    _context: AdapterDetectionContext
  ): Promise<AccountQuotaSnapshot> {
    const credential = parseGitHubCopilotCredential(decryptSecret(account.credentialEncrypted));
    let token = credential.copilot_token ?? "";
    let plan = credential.copilot_plan ?? null;
    let quotaSnapshots = credential.copilot_quota_snapshots;
    let quotaResetDate = credential.copilot_quota_reset_date ?? null;
    let limitedUserQuotas = credential.copilot_limited_user_quotas;
    let limitedUserResetDate = credential.copilot_limited_user_reset_date ?? null;

    if (credential.github_access_token) {
      const bundle = await fetchGitHubCopilotTokenBundle(credential.github_access_token);
      token = bundle.token;
      plan = bundle.plan ?? plan;
      quotaSnapshots = bundle.quotaSnapshots ?? quotaSnapshots;
      quotaResetDate = bundle.quotaResetDate ?? quotaResetDate;
      limitedUserQuotas = bundle.limitedUserQuotas ?? limitedUserQuotas;
      limitedUserResetDate = bundle.limitedUserResetDate ?? limitedUserResetDate;
    } else {
      token = await copilotTokenForCredential(credential);
    }

    const tokenMap = parseTokenMap(token);
    const resetAt = pickCopilotResetAt(limitedUserResetDate, quotaResetDate, tokenMap);
    const snapshots = quotaObject(quotaSnapshots);
    const limited = quotaObject(limitedUserQuotas);
    const completionsSnapshot = quotaObject(snapshots?.completions);
    const chatSnapshot = quotaObject(snapshots?.chat);
    const premiumSnapshot = quotaObject(snapshots?.premium_interactions ?? snapshots?.premium_models);

    const metrics = [
      quotaSnapshotMetric("completions", "Inline Suggestions", completionsSnapshot, resetAt) ??
        limitedQuotaMetric(
          "completions",
          "Inline Suggestions",
          finiteNumber(limited?.completions),
          finiteNumber(tokenMap.cq) ?? finiteNumber(limited?.completions),
          resetAt,
          limited
        ),
      quotaSnapshotMetric("chat", "Chat Messages", chatSnapshot, resetAt) ??
        limitedQuotaMetric(
          "chat",
          "Chat Messages",
          finiteNumber(limited?.chat),
          finiteNumber(tokenMap.tq) ?? finiteNumber(limited?.chat),
          resetAt,
          limited
        ),
      quotaSnapshotMetric("premium", "Premium Requests", premiumSnapshot, resetAt)
    ].filter((metric): metric is AccountQuotaMetric => Boolean(metric));

    return {
      provider: "github_copilot",
      checkedAt: new Date().toISOString(),
      plan,
      metrics,
      summary: quotaSummary(metrics),
      raw: {
        quotaSnapshots,
        quotaResetDate,
        limitedUserQuotas,
        limitedUserResetDate
      }
    };
  }

  async listModels(
    account: AccountRecord,
    channel: ChannelRecord,
    _context: AdapterDetectionContext
  ): Promise<DetectedModel[]> {
    const token = await copilotTokenForAccount(account);
    const response = await fetchWithAccountProxy(copilotModelsUrl(channel.baseUrl), {
      method: "GET",
      headers: copilotHeaders(token)
    }, account);

    if (!response.ok) {
      throw new GatewayError("GITHUB_COPILOT_UPSTREAM_ERROR", await responseText(response), 502);
    }

    const data = (await response.json()) as { data?: unknown[]; models?: unknown[] } | unknown[];
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.models)
          ? data.models
          : [];
    const capabilities = detectedCapabilities(channel);

    return rows
      .map((model) => ({
        upstreamModelName: modelDisplayName(model),
        raw: model
      }))
      .filter((item): item is { upstreamModelName: string; raw: unknown } => Boolean(item.upstreamModelName))
      .map((item) => ({
        upstreamModelName: item.upstreamModelName,
        displayName: item.upstreamModelName,
        capabilities: {
          ...capabilities,
          rawModel: item.raw
        },
        source: "upstream_list"
      }));
  }

  async testModel(
    account: AccountRecord,
    channel: ChannelRecord,
    upstreamModelName: string,
    _context: AdapterDetectionContext
  ): Promise<ModelTestResult> {
    const startedAt = Date.now();
    const token = await copilotTokenForAccount(account);
    const url = copilotChatCompletionsUrl(channel.baseUrl);
    const chatBody = {
      model: upstreamModelName,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      max_tokens: 8
    };
    const streamBody = {
      ...chatBody,
      stream: true
    };
    const [chat, stream] = await Promise.all([
      probeCopilotModelEndpoint(account, url, token, "chat", chatBody, "application/json"),
      probeCopilotModelEndpoint(account, url, token, "stream", streamBody, "text/event-stream")
    ]);
    const available = chat.ok || stream.ok;
    return {
      status: available ? "available" : "unavailable",
      capabilities: {
        ...detectedCapabilities(channel),
        chatCompletions: chat.ok,
        streaming: stream.ok,
        checks: { chat, stream }
      },
      latencyMs: Date.now() - startedAt,
      error: available ? null : firstProbeError([chat, stream])
    };
  }
}
