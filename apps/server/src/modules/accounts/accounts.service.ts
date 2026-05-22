import { and, eq } from "drizzle-orm";
import { adapterRegistry } from "../../adapters/registry";
import { db } from "../../database/client";
import {
  accountModelAliases,
  accountModelCapabilities,
  accounts,
  channels,
  type AccountRecord,
  type ChannelRecord,
  type NewAccountModelAliasRecord,
  type NewAccountRecord
} from "../../database/schema";
import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { pruneInvalidAccountAliasGroupBindings } from "../../core/group-model-binding-sync";
import { decryptSecret, encryptSecret } from "../../utils/crypto";
import { createId } from "../../utils/id";
import {
  bodyObject,
  booleanValue,
  jsonValue,
  nowIso,
  numberValue,
  optionalJsonValue,
  optionalNumber,
  optionalString,
  stringValue
} from "../common/body";

export interface AccountCredentialSummary {
  kind: "api_key" | "oauth_json" | "access_token" | "refresh_token" | "unknown";
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  accountId?: string;
  chatgptAccountId?: string;
  email?: string;
  expired?: boolean;
  expiredAt?: string;
  scopes?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalCredentialString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseScopes(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const scopes = value.map((item) => optionalCredentialString(item)).filter((item): item is string => Boolean(item));
    return scopes.length ? scopes : undefined;
  }
  if (typeof value === "string") {
    const scopes = value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return scopes.length ? scopes : undefined;
  }
  return undefined;
}

function expirationSummary(value: unknown): { expired?: boolean; expiredAt?: string } {
  if (typeof value === "boolean") {
    return { expired: value };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const expiredAt = new Date(millis).toISOString();
    return { expiredAt, expired: millis <= Date.now() };
  }
  const expiredAt = optionalCredentialString(value);
  if (!expiredAt) {
    return {};
  }
  const timestamp = Date.parse(expiredAt);
  return {
    expiredAt,
    expired: Number.isFinite(timestamp) ? timestamp <= Date.now() : undefined
  };
}

function inferCredentialKind(authType: string, credential: string): AccountCredentialSummary["kind"] {
  const normalized = authType.toLowerCase();
  if (normalized.includes("refresh")) return "refresh_token";
  if (normalized.includes("oauth") || normalized.includes("json")) return "oauth_json";
  if (normalized.includes("manual_token") || normalized.includes("access_token") || normalized.includes("codex")) {
    return credential.trim().startsWith("{") ? "oauth_json" : "access_token";
  }
  if (normalized.includes("api_key") || normalized === "bearer") return "api_key";
  if (normalized.includes("token")) return "access_token";
  return "unknown";
}

function summarizeJsonCredential(authType: string, credential: string): AccountCredentialSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(credential);
  } catch {
    return { kind: "unknown" };
  }
  if (!isPlainObject(parsed)) {
    return { kind: "unknown" };
  }

  const accessToken = optionalCredentialString(parsed.access_token ?? parsed.accessToken ?? parsed.token);
  const githubAccessToken = optionalCredentialString(parsed.github_access_token ?? parsed.githubAccessToken);
  const copilotToken = optionalCredentialString(parsed.copilot_token ?? parsed.copilotToken);
  const refreshToken = optionalCredentialString(parsed.refresh_token ?? parsed.refreshToken);
  const accountId = optionalCredentialString(
    parsed.account_id ??
      parsed.accountId ??
      parsed.github_login ??
      parsed.githubLogin ??
      parsed.github_id ??
      parsed.githubId ??
      parsed.id ??
      parsed.sub
  );
  const chatgptAccountId = optionalCredentialString(parsed.chatgpt_account_id ?? parsed.chatgptAccountId);
  const email = optionalCredentialString(
    parsed.email ?? parsed.github_email ?? parsed.githubEmail ?? parsed.account_email ?? parsed.accountEmail ?? parsed.user_email ?? parsed.userEmail
  );
  const expiration = expirationSummary(
    parsed.expired_at ?? parsed.expires_at ?? parsed.expired ?? parsed.expiresAt ?? parsed.copilot_expires_at ?? parsed.copilotExpiresAt
  );
  const scopes = parseScopes(parsed.scopes ?? parsed.scope);

  return {
    kind: accessToken || githubAccessToken || copilotToken || refreshToken || authType.toLowerCase().includes("oauth") ? "oauth_json" : "unknown",
    hasAccessToken: Boolean(accessToken || githubAccessToken || copilotToken),
    hasRefreshToken: Boolean(refreshToken),
    accountId,
    chatgptAccountId,
    email,
    ...expiration,
    scopes
  };
}

export function summarizeAccountCredential(account: AccountRecord): AccountCredentialSummary {
  let credential: string;
  try {
    credential = decryptSecret(account.credentialEncrypted);
  } catch {
    return { kind: "unknown" };
  }

  const trimmed = credential.trim();
  if (!trimmed) {
    return { kind: "unknown" };
  }

  if (trimmed.startsWith("{")) {
    return summarizeJsonCredential(account.authType, trimmed);
  }

  const kind = inferCredentialKind(account.authType, trimmed);
  if (kind === "access_token") {
    return { kind, hasAccessToken: true };
  }
  if (kind === "refresh_token") {
    return { kind, hasRefreshToken: true };
  }
  return { kind };
}

export function sanitizeAccount(account: AccountRecord) {
  const { credentialEncrypted: _credentialEncrypted, ...safe } = account;
  return {
    ...safe,
    hasCredential: true,
    credentialSummary: summarizeAccountCredential(account)
  };
}

export async function listAccounts() {
  const rows = await db.select().from(accounts);
  return rows.map(sanitizeAccount);
}

export async function getAccount(id: string) {
  const account = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) {
    throw new GatewayError("NOT_FOUND", "Account not found", 404);
  }
  return sanitizeAccount(account);
}

async function getRawAccount(id: string): Promise<AccountRecord> {
  const account = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) {
    throw new GatewayError("NOT_FOUND", "Account not found", 404);
  }
  return account;
}

async function getAccountChannel(account: AccountRecord): Promise<ChannelRecord> {
  const channel = await db.select().from(channels).where(eq(channels.id, account.channelId)).get();
  if (!channel) {
    throw new GatewayError("NOT_FOUND", "Channel not found for account", 404);
  }
  return channel;
}

function quotaRequestId(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const requestId = (input as Record<string, unknown>).requestId;
    if (typeof requestId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) {
      return requestId;
    }
  }
  return createId("quota");
}

export async function createAccount(input: unknown) {
  const body = bodyObject(input);
  const credential = stringValue(body, "credential");
  const record: NewAccountRecord = {
    id: createId("acc"),
    channelId: stringValue(body, "channelId", "channel_id"),
    name: stringValue(body, "name"),
    authType: stringValue(body, "authType", "auth_type", "bearer"),
    credentialEncrypted: encryptSecret(credential),
    proxy: optionalString(body, "proxy") ?? null,
    tags: jsonValue(body, "tags", "tags", []),
    weight: numberValue(body, "weight", "weight", 1),
    concurrencyLimit: numberValue(body, "concurrencyLimit", "concurrency_limit", 5),
    currentConcurrency: 0,
    status: stringValue(body, "status", "status", "enabled"),
    healthStatus: stringValue(body, "healthStatus", "health_status", "healthy"),
    quotaLimit: optionalNumber(body, "quotaLimit", "quota_limit") ?? null,
    quotaUsed: 0,
    quotaSnapshot: null,
    quotaCheckedAt: null,
    quotaLastError: null,
    quotaLastErrorAt: null,
    cooldownUntil: optionalString(body, "cooldownUntil", "cooldown_until") ?? null,
    lastError: null,
    lastSuccessAt: null,
    lastFailureAt: null
  };
  await db.insert(accounts).values(record);
  return getAccount(record.id);
}

export async function updateAccount(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewAccountRecord> = { updatedAt: nowIso() };
  const quotaIdentityChanged =
    body.channelId !== undefined ||
    body.channel_id !== undefined ||
    body.authType !== undefined ||
    body.auth_type !== undefined ||
    body.credential !== undefined;
  if (body.channelId !== undefined || body.channel_id !== undefined) patch.channelId = stringValue(body, "channelId", "channel_id");
  if (body.name !== undefined) patch.name = stringValue(body, "name");
  if (body.authType !== undefined || body.auth_type !== undefined) patch.authType = stringValue(body, "authType", "auth_type");
  if (body.credential !== undefined) patch.credentialEncrypted = encryptSecret(stringValue(body, "credential"));
  if (quotaIdentityChanged) {
    patch.quotaSnapshot = null;
    patch.quotaCheckedAt = null;
    patch.quotaLastError = null;
    patch.quotaLastErrorAt = null;
  }
  if (body.proxy !== undefined) patch.proxy = optionalString(body, "proxy") ?? null;
  if (body.tags !== undefined) patch.tags = optionalJsonValue(body, "tags");
  if (body.weight !== undefined) patch.weight = optionalNumber(body, "weight") ?? 1;
  if (body.concurrencyLimit !== undefined || body.concurrency_limit !== undefined) patch.concurrencyLimit = optionalNumber(body, "concurrencyLimit", "concurrency_limit") ?? 5;
  if (body.currentConcurrency !== undefined || body.current_concurrency !== undefined) patch.currentConcurrency = optionalNumber(body, "currentConcurrency", "current_concurrency") ?? 0;
  if (body.status !== undefined) patch.status = stringValue(body, "status");
  if (body.healthStatus !== undefined || body.health_status !== undefined) patch.healthStatus = stringValue(body, "healthStatus", "health_status");
  if (body.quotaLimit !== undefined || body.quota_limit !== undefined) patch.quotaLimit = optionalNumber(body, "quotaLimit", "quota_limit") ?? null;
  if (body.cooldownUntil !== undefined || body.cooldown_until !== undefined) patch.cooldownUntil = optionalString(body, "cooldownUntil", "cooldown_until") ?? null;
  if (body.lastSuccessAt !== undefined || body.last_success_at !== undefined) patch.lastSuccessAt = optionalString(body, "lastSuccessAt", "last_success_at") ?? null;
  if (body.lastFailureAt !== undefined || body.last_failure_at !== undefined) patch.lastFailureAt = optionalString(body, "lastFailureAt", "last_failure_at") ?? null;
  await db.update(accounts).set(patch).where(eq(accounts.id, id));
  return getAccount(id);
}

export async function deleteAccount(id: string) {
  await getAccount(id);
  await db.delete(accounts).where(eq(accounts.id, id));
  return { ok: true };
}

export async function clearAccountError(id: string) {
  const account = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) {
    throw new GatewayError("NOT_FOUND", "Account not found", 404);
  }

  await db
    .update(accounts)
    .set({
      lastError: null,
      cooldownUntil: null,
      healthStatus: account.status === "enabled" ? "healthy" : account.healthStatus,
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, id));
  return getAccount(id);
}

export async function resetAccountConcurrency(id: string) {
  await getAccount(id);
  await db
    .update(accounts)
    .set({
      currentConcurrency: 0,
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, id));
  return getAccount(id);
}

export async function enableAccount(id: string) {
  await getAccount(id);
  await db
    .update(accounts)
    .set({
      status: "enabled",
      healthStatus: "healthy",
      cooldownUntil: null,
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, id));
  return getAccount(id);
}

export async function disableAccount(id: string) {
  await getAccount(id);
  await db
    .update(accounts)
    .set({
      status: "disabled",
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, id));
  return getAccount(id);
}

export async function checkAccountQuota(id: string, input?: unknown) {
  const account = await getRawAccount(id);
  const channel = await getAccountChannel(account);
  const adapter = adapterRegistry.get(channel.adapterType);
  if (!adapter) {
    throw new GatewayError("ADAPTER_NOT_FOUND", "Adapter was not found for account channel", 500);
  }
  if (!adapter.checkQuota) {
    throw new GatewayError("NOT_IMPLEMENTED", "This adapter does not support upstream quota checks", 501);
  }

  try {
    const snapshot = await adapter.checkQuota(account, channel, { requestId: quotaRequestId(input) });
    const checkedAt = snapshot.checkedAt || nowIso();
    await db
      .update(accounts)
      .set({
        quotaSnapshot: snapshot as unknown as Record<string, unknown>,
        quotaCheckedAt: checkedAt,
        quotaLastError: null,
        quotaLastErrorAt: null,
        updatedAt: nowIso()
      })
      .where(eq(accounts.id, id));
    return getAccount(id);
  } catch (error) {
    const now = nowIso();
    await db
      .update(accounts)
      .set({
        quotaLastError: toSafeErrorMessage(error).slice(0, 1000),
        quotaLastErrorAt: now,
        updatedAt: now
      })
      .where(eq(accounts.id, id));
    throw error;
  }
}

async function ensureAvailableUpstreamModel(accountId: string, upstreamModelName: string): Promise<void> {
  const capability = await db
    .select()
    .from(accountModelCapabilities)
    .where(
      and(
        eq(accountModelCapabilities.accountId, accountId),
        eq(accountModelCapabilities.upstreamModelName, upstreamModelName),
        eq(accountModelCapabilities.status, "available")
      )
    )
    .get();

  if (!capability) {
    throw new GatewayError("VALIDATION_ERROR", "upstream_model must be an available detected model for this account", 400);
  }
}

export async function listAccountModelAliases(accountId: string) {
  await getRawAccount(accountId);
  return db.select().from(accountModelAliases).where(eq(accountModelAliases.accountId, accountId));
}

export async function createAccountModelAlias(accountId: string, input: unknown) {
  const account = await getRawAccount(accountId);
  const body = bodyObject(input);
  const publicModel = stringValue(body, "publicModel", "public_model");
  const upstreamModelName = stringValue(body, "upstreamModel", "upstream_model");
  await ensureAvailableUpstreamModel(account.id, upstreamModelName);

  const now = nowIso();
  const record: NewAccountModelAliasRecord = {
    id: createId("ama"),
    accountId: account.id,
    publicModel,
    upstreamModelName,
    enabled: booleanValue(body, "enabled", "enabled", true),
    createdAt: now,
    updatedAt: now
  };
  await db.insert(accountModelAliases).values(record);
  await pruneInvalidAccountAliasGroupBindings(account.id);
  return db.select().from(accountModelAliases).where(eq(accountModelAliases.id, record.id)).get();
}

export async function updateAccountModelAlias(accountId: string, aliasId: string, input: unknown) {
  await getRawAccount(accountId);
  const existing = await db
    .select()
    .from(accountModelAliases)
    .where(and(eq(accountModelAliases.id, aliasId), eq(accountModelAliases.accountId, accountId)))
    .get();
  if (!existing) {
    throw new GatewayError("NOT_FOUND", "Account model alias not found", 404);
  }

  const body = bodyObject(input);
  const patch: Partial<NewAccountModelAliasRecord> = { updatedAt: nowIso() };
  if (body.publicModel !== undefined || body.public_model !== undefined) {
    patch.publicModel = stringValue(body, "publicModel", "public_model");
  }
  if (body.upstreamModel !== undefined || body.upstream_model !== undefined) {
    patch.upstreamModelName = stringValue(body, "upstreamModel", "upstream_model");
    await ensureAvailableUpstreamModel(accountId, patch.upstreamModelName);
  }
  if (body.enabled !== undefined) {
    patch.enabled = booleanValue(body, "enabled");
  }

  await db.update(accountModelAliases).set(patch).where(eq(accountModelAliases.id, aliasId));
  await pruneInvalidAccountAliasGroupBindings(accountId);
  return db.select().from(accountModelAliases).where(eq(accountModelAliases.id, aliasId)).get();
}

export async function deleteAccountModelAlias(accountId: string, aliasId: string) {
  await getRawAccount(accountId);
  const existing = await db
    .select()
    .from(accountModelAliases)
    .where(and(eq(accountModelAliases.id, aliasId), eq(accountModelAliases.accountId, accountId)))
    .get();
  if (!existing) {
    throw new GatewayError("NOT_FOUND", "Account model alias not found", 404);
  }
  await db.delete(accountModelAliases).where(eq(accountModelAliases.id, aliasId));
  await pruneInvalidAccountAliasGroupBindings(accountId);
  return { ok: true };
}
