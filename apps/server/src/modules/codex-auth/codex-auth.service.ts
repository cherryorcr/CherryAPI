import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { parseCodexCredential } from "../../adapters/codex.adapter";
import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { fetchWithProxy } from "../../core/proxy-fetch";
import { createId } from "../../utils/id";
import { bodyObject, jsonValue, numberValue, optionalString, stringValue } from "../common/body";
import { createPlatformAccount } from "../platforms/platforms.service";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_SCOPES = "openid profile email offline_access";
const CODEX_ORIGINATOR = "codex_vscode";
const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_HOST = process.env.CODEX_CALLBACK_HOST?.trim() || "127.0.0.1";
const CODEX_REDIRECT_URI = `http://localhost:${CODEX_CALLBACK_PORT}/auth/callback`;
const CODEX_OAUTH_TIMEOUT_SECONDS = 300;
const CODEX_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;
const CODEX_TOKEN_EXCHANGE_ATTEMPTS = 3;
const CODEX_TOKEN_EXCHANGE_RETRY_DELAY_MS = 800;

type CodexOAuthStatus = "pending" | "authorized" | "completed" | "failed" | "expired" | "cancelled";
type ChannelMode = "use_existing" | "create_new" | "auto_create";

interface CodexOAuthSession {
  id: string;
  state: string;
  codeVerifier?: string;
  codeChallenge: string;
  redirectUri: string;
  authUrl: string;
  code?: string;
  status: CodexOAuthStatus;
  message: string | null;
  error?: string;
  createdAt: number;
  expiresAt: number;
  channelMode: ChannelMode;
  channelId?: string;
  channel?: unknown;
  accountDefaults: {
    name: string;
    tags: string[];
    weight: number;
    concurrencyLimit: number;
    status: string;
  };
  account?: unknown;
  channelRecord?: unknown;
  credentialSummary?: unknown;
}

interface CodexTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const sessions = new Map<string, CodexOAuthSession>();
let callbackServer: Server | null = null;
let callbackServerStarting: Promise<void> | null = null;

function channelModeValue(value: unknown): ChannelMode {
  if (value === "use_existing" || value === "create_new" || value === "auto_create") {
    return value;
  }
  throw new GatewayError("VALIDATION_ERROR", "channelMode must be use_existing, create_new, or auto_create", 400);
}

function expiresAt(): number {
  return Date.now() + CODEX_OAUTH_TIMEOUT_SECONDS * 1000;
}

function expiresIso(session: CodexOAuthSession): string {
  return new Date(session.expiresAt).toISOString();
}

function isExpired(session: CodexOAuthSession): boolean {
  return session.expiresAt <= Date.now();
}

function trimText(text: string, length = 1000): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableTokenStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
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

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function authClaim(tokenPayload: Record<string, unknown>): Record<string, unknown> {
  const claim = tokenPayload["https://api.openai.com/auth"];
  return claim && typeof claim === "object" && !Array.isArray(claim) ? (claim as Record<string, unknown>) : {};
}

function sessionView(session: CodexOAuthSession) {
  if (isExpired(session) && session.status === "pending") {
    session.status = "expired";
    session.message = "OAuth session expired.";
    session.error = "expired";
    maybeStopCallbackServer();
  }
  return {
    sessionId: session.id,
    status: session.status,
    message: session.message ?? undefined,
    expiresAt: expiresIso(session),
    credentialSummary: session.credentialSummary,
    account: session.account
  };
}

function getSession(sessionId: string): CodexOAuthSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new GatewayError("NOT_FOUND", "Codex OAuth session not found", 404);
  }
  sessionView(session);
  return session;
}

function findSessionByState(state: string | null): CodexOAuthSession | undefined {
  if (!state) {
    return undefined;
  }
  return [...sessions.values()].find((session) => session.state === state);
}

function parseAccountDefaults(input: unknown): CodexOAuthSession["accountDefaults"] {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "codex-oauth",
    tags: jsonValue(body, "tags", "tags", ["coding", "normal"]),
    weight: numberValue(body, "weight", "weight", 1),
    concurrencyLimit: numberValue(body, "concurrencyLimit", "concurrency_limit", 1),
    status: typeof body.status === "string" && body.status.trim() ? body.status.trim() : "enabled"
  };
}

function buildAuthUrl(state: string, challenge: string): string {
  const url = new URL(CODEX_AUTH_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", CODEX_REDIRECT_URI);
  url.searchParams.set("scope", CODEX_SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("originator", CODEX_ORIGINATOR);
  return url.toString();
}

function html(reply: ServerResponse, statusCode: number, title: string, body: string): void {
  reply.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  reply.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`);
}

function handleCallback(url: URL, reply: ServerResponse): void {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const session = findSessionByState(state);

  if (!session) {
    html(reply, 400, "Authorization failed", "Invalid or expired OAuth state. Return to CherryAPI and retry.");
    return;
  }
  if (isExpired(session)) {
    session.status = "expired";
    session.error = "expired";
    session.message = "OAuth session expired.";
    html(reply, 400, "Authorization expired", "Return to CherryAPI and start a new OAuth login.");
    maybeStopCallbackServer();
    return;
  }
  if (error) {
    session.status = "failed";
    session.error = error;
    session.message = "OpenAI authorization failed.";
    html(reply, 400, "Authorization failed", "OpenAI returned an authorization error. Return to CherryAPI and retry.");
    maybeStopCallbackServer();
    return;
  }
  if (!code) {
    session.status = "failed";
    session.error = "missing_code";
    session.message = "OAuth callback did not include a code.";
    html(reply, 400, "Authorization failed", "The callback did not include an authorization code.");
    maybeStopCallbackServer();
    return;
  }

  session.code = code;
  session.status = "authorized";
  session.message = "Authorization received. Return to CherryAPI to complete login.";
  html(reply, 200, "Authorization succeeded", "You can close this window and return to CherryAPI.");
  maybeStopCallbackServer();
}

function handleCancel(url: URL, reply: ServerResponse): void {
  const session = findSessionByState(url.searchParams.get("state"));
  if (session && session.status === "pending") {
    session.status = "cancelled";
    session.message = "OAuth session cancelled.";
  }
  html(reply, 200, "Authorization cancelled", "You can close this window and return to CherryAPI.");
  maybeStopCallbackServer();
}

function hasActivePendingSession(): boolean {
  return [...sessions.values()].some((session) => session.status === "pending" && !isExpired(session));
}

function maybeStopCallbackServer(): void {
  if (!callbackServer || hasActivePendingSession()) {
    return;
  }
  const server = callbackServer;
  callbackServer = null;
  server.close();
}

async function ensureCallbackServer(): Promise<void> {
  if (callbackServer) {
    return;
  }
  if (callbackServerStarting) {
    return callbackServerStarting;
  }

  callbackServerStarting = new Promise<void>((resolve, reject) => {
    const server = createServer((request, reply) => {
      try {
        const url = new URL(request.url ?? "/", CODEX_REDIRECT_URI);
        if (request.method === "GET" && url.pathname === "/auth/callback") {
          handleCallback(url, reply);
          return;
        }
        if (request.method === "GET" && url.pathname === "/cancel") {
          handleCancel(url, reply);
          return;
        }
        html(reply, 404, "Not found", "Unknown Codex OAuth callback path.");
      } catch {
        html(reply, 500, "Callback error", "CherryAPI could not process the OAuth callback.");
      }
    });

    server.once("error", (error: NodeJS.ErrnoException) => {
      callbackServerStarting = null;
      if (error.code === "EADDRINUSE") {
        reject(
          new GatewayError(
            "CODEX_OAUTH_PORT_IN_USE",
            "Port 1455 is already in use. Close other Codex OAuth login windows or related tools, then retry.",
            409
          )
        );
        return;
      }
      reject(new GatewayError("CODEX_OAUTH_CALLBACK_ERROR", `Failed to start Codex OAuth callback server: ${toSafeErrorMessage(error)}`, 500));
    });
    server.listen(CODEX_CALLBACK_PORT, CODEX_CALLBACK_HOST, () => {
      callbackServer = server;
      callbackServerStarting = null;
      resolve();
    });
  });

  return callbackServerStarting;
}

function credentialFromTokens(tokens: CodexTokenResponse): string {
  if (!tokens.access_token || !tokens.id_token) {
    throw new GatewayError("CODEX_AUTH_ERROR", "Codex OAuth token response did not include required tokens", 401);
  }
  const accessPayload = decodeJwtPayload(tokens.access_token);
  const idPayload = decodeJwtPayload(tokens.id_token);
  const auth = authClaim(accessPayload);
  const exp = typeof accessPayload.exp === "number" ? new Date(accessPayload.exp * 1000).toISOString() : undefined;
  const email = optionalText(idPayload.email ?? accessPayload.email);
  const chatgptAccountId = optionalText(auth.chatgpt_account_id ?? auth.account_id);
  const accountId = optionalText(accessPayload.sub ?? idPayload.sub);
  return JSON.stringify({
    type: "codex_oauth",
    id_token: tokens.id_token,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expired: false,
    expired_at: exp,
    expires_at: exp,
    email,
    account_id: accountId,
    chatgpt_account_id: chatgptAccountId,
    scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : CODEX_SCOPES.split(/\s+/),
    source: "oauth_login",
    created_at: new Date().toISOString()
  });
}

async function exchangeCode(session: CodexOAuthSession): Promise<string> {
  if (!session.code || !session.codeVerifier) {
    throw new GatewayError("VALIDATION_ERROR", "OAuth session is not authorized yet", 400);
  }

  let lastFailure: string | null = null;
  for (let attempt = 1; attempt <= CODEX_TOKEN_EXCHANGE_ATTEMPTS; attempt += 1) {
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: session.code,
        redirect_uri: session.redirectUri,
        client_id: CODEX_CLIENT_ID,
        code_verifier: session.codeVerifier
      });
      const response = await fetchWithProxy(CODEX_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body,
        signal: AbortSignal.timeout(CODEX_TOKEN_EXCHANGE_TIMEOUT_MS)
      });
      const text = await response.text();
      if (!response.ok) {
        lastFailure = `HTTP ${response.status}: ${trimText(text)}`;
        if (attempt < CODEX_TOKEN_EXCHANGE_ATTEMPTS && retryableTokenStatus(response.status)) {
          await delay(CODEX_TOKEN_EXCHANGE_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new GatewayError("CODEX_AUTH_ERROR", `Codex OAuth token exchange failed (${lastFailure})`, 401);
      }

      let tokens: CodexTokenResponse;
      try {
        tokens = JSON.parse(text) as CodexTokenResponse;
      } catch {
        throw new GatewayError("CODEX_AUTH_ERROR", "Codex OAuth token endpoint returned invalid JSON", 401);
      }
      return credentialFromTokens(tokens);
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      lastFailure = toSafeErrorMessage(error);
      if (attempt < CODEX_TOKEN_EXCHANGE_ATTEMPTS) {
        await delay(CODEX_TOKEN_EXCHANGE_RETRY_DELAY_MS * attempt);
        continue;
      }
    }
  }

  throw new GatewayError(
    "CODEX_AUTH_ERROR",
    `Codex OAuth token exchange network failed after ${CODEX_TOKEN_EXCHANGE_ATTEMPTS} attempts. Check Proxy config and retry Complete Login. Last error: ${lastFailure ?? "unknown error"}`,
    502
  );
}

async function createCodexAccountFromCredential(session: CodexOAuthSession, credential: string) {
  parseCodexCredential(credential);
  const response = await createPlatformAccount("codex", {
    loginMethodId: "codex_oauth_json",
    channelMode: session.channelMode,
    channelId: session.channelId,
    channel: session.channel,
    account: {
      name: session.accountDefaults.name,
      auth_type: "codex_oauth",
      credential,
      tags: session.accountDefaults.tags,
      weight: session.accountDefaults.weight,
      concurrency_limit: session.accountDefaults.concurrencyLimit,
      status: session.accountDefaults.status,
      health_status: "healthy"
    }
  });
  session.status = "completed";
  session.message = "Codex OAuth credential saved.";
  session.account = response.account;
  session.channelRecord = response.channel;
  session.credentialSummary = response.account.credentialSummary;
  session.code = undefined;
  session.codeVerifier = undefined;
  return {
    ...response,
    credentialSummary: session.credentialSummary
  };
}

export async function startCodexOAuth(input: unknown) {
  const body = bodyObject(input ?? {});
  await ensureCallbackServer();

  const id = createId("codex_oauth");
  const verifier = randomToken(48);
  const challenge = codeChallenge(verifier);
  const state = randomToken(32);
  const session: CodexOAuthSession = {
    id,
    state,
    codeVerifier: verifier,
    codeChallenge: challenge,
    redirectUri: CODEX_REDIRECT_URI,
    authUrl: buildAuthUrl(state, challenge),
    status: "pending",
    message: "Open the login URL and complete sign-in.",
    createdAt: Date.now(),
    expiresAt: expiresAt(),
    channelMode: channelModeValue(body.channelMode ?? body.channel_mode ?? "auto_create"),
    channelId: optionalString(body, "channelId", "channel_id") ?? undefined,
    channel: body.channel,
    accountDefaults: parseAccountDefaults(body.accountDefaults ?? body.account_defaults)
  };
  sessions.set(id, session);

  return {
    sessionId: id,
    authUrl: session.authUrl,
    expiresAt: expiresIso(session),
    instructions: "Open the login URL and complete sign-in."
  };
}

export async function getCodexOAuthStatus(sessionId: string) {
  return sessionView(getSession(sessionId));
}

export async function completeCodexOAuth(input: unknown) {
  const body = bodyObject(input);
  const session = getSession(stringValue(body, "sessionId", "session_id"));
  if (session.status === "cancelled" || session.status === "expired") {
    throw new GatewayError("VALIDATION_ERROR", `Cannot complete a ${session.status} OAuth session`, 400);
  }
  if (session.status === "completed") {
    return {
      account: session.account,
      channel: session.channelRecord,
      credentialSummary: session.credentialSummary
    };
  }

  try {
    const fallbackCredential = optionalString(body, "credential");
    if (fallbackCredential) {
      return await createCodexAccountFromCredential(session, fallbackCredential);
    }
    const canRetryFailedExchange = session.status === "failed" && Boolean(session.code && session.codeVerifier);
    if (session.status !== "authorized" && !canRetryFailedExchange) {
      throw new GatewayError("VALIDATION_ERROR", "OAuth authorization has not been received yet", 400);
    }
    session.status = "authorized";
    session.message = "Authorization received. Completing Codex login...";
    const credential = await exchangeCode(session);
    return await createCodexAccountFromCredential(session, credential);
  } catch (error) {
    session.status = "failed";
    session.error = toSafeErrorMessage(error);
    session.message = session.error;
    throw error;
  }
}

export async function cancelCodexOAuth(input: unknown) {
  const body = bodyObject(input);
  const session = getSession(stringValue(body, "sessionId", "session_id"));
  session.status = "cancelled";
  session.message = "OAuth session cancelled.";
  session.code = undefined;
  session.codeVerifier = undefined;
  maybeStopCallbackServer();
  return sessionView(session);
}
