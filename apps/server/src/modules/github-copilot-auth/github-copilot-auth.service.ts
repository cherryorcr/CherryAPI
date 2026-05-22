import { execFile } from "node:child_process";
import { createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import {
  buildGitHubCopilotCredentialFromAccessToken,
  parseGitHubCopilotCredential,
  refreshGitHubCopilotCredential
} from "../../adapters/github-copilot.adapter";
import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { fetchWithProxy } from "../../core/proxy-fetch";
import { db } from "../../database/client";
import { accounts } from "../../database/schema";
import { decryptSecret, encryptSecret } from "../../utils/crypto";
import { createId } from "../../utils/id";
import { bodyObject, jsonValue, nowIso, numberValue, optionalString, stringValue } from "../common/body";
import { getAccount } from "../accounts/accounts.service";
import { createPlatformAccount } from "../platforms/platforms.service";

const GITHUB_DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const GITHUB_DEVICE_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_OAUTH_CLIENT_ID = "01ab8ac9400c4e429b23";
const GITHUB_OAUTH_SCOPE = "read:user user:email repo workflow";
const APP_USER_AGENT = "CherryAPI GitHubCopilot";
const OAUTH_TIMEOUT_SECONDS = 900;
const VSCODE_GITHUB_AUTH_SECRET_KEY = 'secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}';
const VSCODE_GITHUB_COPILOT_LOGIN_KEY = "github.copilot-github";
const VSCODE_SAFE_STORAGE_PREFIX = Buffer.from("v10");

const execFileAsync = promisify(execFile);

type GitHubCopilotOAuthStatus = "pending" | "authorized" | "completed" | "failed" | "expired" | "cancelled";
type ChannelMode = "use_existing" | "create_new" | "auto_create";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface DeviceTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubCopilotOAuthSession {
  id: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  status: GitHubCopilotOAuthStatus;
  message: string | null;
  error?: string;
  createdAt: number;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  credential?: string;
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

interface VSCodeGitHubAuthSession {
  accessToken?: string;
  account?: {
    id?: string;
    label?: string;
  };
  scopes?: unknown[];
}

const sessions = new Map<string, GitHubCopilotOAuthSession>();

function trimText(text: string, length = 1000): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function channelModeValue(value: unknown): ChannelMode {
  if (value === "use_existing" || value === "create_new" || value === "auto_create") {
    return value;
  }
  throw new GatewayError("VALIDATION_ERROR", "channelMode must be use_existing, create_new, or auto_create", 400);
}

function expiresIso(session: GitHubCopilotOAuthSession): string {
  return new Date(session.expiresAt).toISOString();
}

function isExpired(session: GitHubCopilotOAuthSession): boolean {
  return session.expiresAt <= Date.now();
}

function sessionView(session: GitHubCopilotOAuthSession) {
  if (isExpired(session) && session.status === "pending") {
    session.status = "expired";
    session.message = "GitHub device authorization expired.";
    session.error = "expired";
  }
  return {
    sessionId: session.id,
    status: session.status,
    message: session.message ?? undefined,
    expiresAt: expiresIso(session),
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    verificationUriComplete: session.verificationUriComplete,
    authUrl: session.verificationUriComplete ?? session.verificationUri,
    credentialSummary: session.credentialSummary,
    account: session.account
  };
}

function getSession(sessionId: string): GitHubCopilotOAuthSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new GatewayError("NOT_FOUND", "GitHub Copilot OAuth session not found", 404);
  }
  sessionView(session);
  return session;
}

function parseAccountDefaults(input: unknown): GitHubCopilotOAuthSession["accountDefaults"] {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "github-copilot-oauth",
    tags: jsonValue(body, "tags", "tags", ["coding", "normal"]),
    weight: numberValue(body, "weight", "weight", 1),
    concurrencyLimit: numberValue(body, "concurrencyLimit", "concurrency_limit", 1),
    status: typeof body.status === "string" && body.status.trim() ? body.status.trim() : "enabled"
  };
}

function vscodeDataRootCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "Code"), path.join(appData, "Code - Insiders")];
  }
  if (process.platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [path.join(base, "Code"), path.join(base, "Code - Insiders")];
  }
  if (process.platform === "linux") {
    const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
    return [path.join(base, "Code"), path.join(base, "Code - Insiders")];
  }
  return [];
}

function vscodeStateDbPath(dataRoot: string): string {
  return path.join(dataRoot, "User", "globalStorage", "state.vscdb");
}

function vscodeSharedStorageDbPath(dataRoot: string): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const folderName = path.basename(dataRoot).toLowerCase() === "code - insiders" ? ".vscode-shared-insiders" : ".vscode-shared";
  return path.join(os.homedir(), folderName, "sharedStorage", "state.vscdb");
}

function vscodeSharedStorageDbExists(dataRoot: string): boolean {
  const sharedPath = vscodeSharedStorageDbPath(dataRoot);
  return Boolean(sharedPath && fs.existsSync(sharedPath));
}

function resolveVSCodeDataRoot(input?: string | null): string {
  if (input?.trim()) {
    return path.resolve(input.trim());
  }
  const candidates = vscodeDataRootCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(vscodeStateDbPath(candidate)) || vscodeSharedStorageDbExists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const first = candidates[0];
  if (!first) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "Local VS Code import is not supported on this platform", 400);
  }
  return first;
}

function copilotLoginDbPaths(dataRoot: string): string[] {
  const legacyPath = vscodeStateDbPath(dataRoot);
  if (process.platform !== "win32") {
    return [legacyPath];
  }
  const paths = [vscodeSharedStorageDbPath(dataRoot), legacyPath].filter((item): item is string => Boolean(item));
  return [...new Set(paths)];
}

async function readItemTableValue(dbPath: string, key: string): Promise<string | undefined> {
  if (!fs.existsSync(dbPath)) {
    return undefined;
  }
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute({
      sql: "SELECT value FROM ItemTable WHERE key = ?",
      args: [key]
    });
    const value = result.rows[0]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch (error) {
    throw new GatewayError(
      "GITHUB_COPILOT_AUTH_ERROR",
      `Failed to read VS Code state database ${dbPath}: ${toSafeErrorMessage(error)}`,
      400
    );
  } finally {
    client.close();
  }
}

async function readLocalCopilotLogin(dataRoot: string): Promise<{ login: string; dbPath: string } | undefined> {
  for (const dbPath of copilotLoginDbPaths(dataRoot)) {
    const login = await readItemTableValue(dbPath, VSCODE_GITHUB_COPILOT_LOGIN_KEY);
    if (login) {
      return { login, dbPath };
    }
  }
  return undefined;
}

function decodeBufferJson(value: unknown): Buffer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code secret value is not a Buffer JSON object", 400);
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code secret value does not include Buffer data", 400);
  }
  return Buffer.from(data.map((item) => Number(item) & 0xff));
}

async function dpapiDecrypt(encrypted: Buffer): Promise<Buffer> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String($args[0])
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript, encrypted.toString("base64")],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 }
    );
    const output = stdout.trim();
    if (!output) {
      throw new Error("PowerShell returned empty DPAPI output");
    }
    return Buffer.from(output, "base64");
  } catch (error) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", `Failed to decrypt VS Code secret key: ${toSafeErrorMessage(error)}`, 400);
  }
}

async function getWindowsSafeStorageKey(dataRoot: string): Promise<Buffer> {
  const localStatePath = path.join(dataRoot, "Local State");
  if (!fs.existsSync(localStatePath)) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", `VS Code Local State not found: ${localStatePath}`, 400);
  }
  const parsed = JSON.parse(fs.readFileSync(localStatePath, "utf8")) as Record<string, unknown>;
  const encryptedKey = ((parsed.os_crypt as Record<string, unknown> | undefined)?.encrypted_key);
  if (typeof encryptedKey !== "string") {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code Local State does not include os_crypt.encrypted_key", 400);
  }
  const encryptedKeyBytes = Buffer.from(encryptedKey, "base64");
  if (!encryptedKeyBytes.subarray(0, 5).equals(Buffer.from("DPAPI"))) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code encrypted key does not use DPAPI", 400);
  }
  const key = await dpapiDecrypt(encryptedKeyBytes.subarray(5));
  if (key.length !== 32) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", `VS Code safe storage key has unexpected length ${key.length}`, 400);
  }
  return key;
}

async function decryptWindowsSafeStorageValue(encrypted: Buffer, dataRoot: string): Promise<Buffer> {
  if (encrypted.length < 31 || !encrypted.subarray(0, 3).equals(VSCODE_SAFE_STORAGE_PREFIX)) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code secret value is not Windows v10 safe-storage data", 400);
  }
  const key = await getWindowsSafeStorageKey(dataRoot);
  const nonce = encrypted.subarray(3, 15);
  const ciphertextAndTag = encrypted.subarray(15);
  const ciphertext = ciphertextAndTag.subarray(0, -16);
  const authTag = ciphertextAndTag.subarray(-16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", `Failed to decrypt VS Code GitHub session: ${toSafeErrorMessage(error)}`, 400);
  }
}

async function decodeVSCodeSecretStorageValue(rawValue: string, dataRoot: string): Promise<string> {
  const parsed = JSON.parse(rawValue) as unknown;
  if (Array.isArray(parsed)) {
    return JSON.stringify(parsed);
  }
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    const encrypted = decodeBufferJson(parsed);
    if (process.platform !== "win32") {
      throw new GatewayError(
        "GITHUB_COPILOT_AUTH_ERROR",
        "Local VS Code GitHub session decryption is currently implemented for Windows safe storage",
        400
      );
    }
    return (await decryptWindowsSafeStorageValue(encrypted, dataRoot)).toString("utf8");
  }
  return JSON.stringify(parsed);
}

async function readGitHubAuthSecret(dataRoot: string): Promise<string | undefined> {
  const sharedPath = vscodeSharedStorageDbPath(dataRoot);
  if (sharedPath) {
    const rawSharedValue = await readItemTableValue(sharedPath, VSCODE_GITHUB_AUTH_SECRET_KEY);
    if (rawSharedValue) {
      return decodeVSCodeSecretStorageValue(rawSharedValue, dataRoot);
    }
  }
  const rawValue = await readItemTableValue(vscodeStateDbPath(dataRoot), VSCODE_GITHUB_AUTH_SECRET_KEY);
  return rawValue ? decodeVSCodeSecretStorageValue(rawValue, dataRoot) : undefined;
}

async function readGitHubAuthSessions(dataRoot: string): Promise<VSCodeGitHubAuthSession[] | undefined> {
  const rawValue = await readGitHubAuthSecret(dataRoot);
  if (!rawValue) {
    return undefined;
  }
  const parsed = JSON.parse(rawValue) as unknown;
  if (!Array.isArray(parsed)) {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "VS Code github.auth secret is not a session array", 400);
  }
  return parsed as VSCodeGitHubAuthSession[];
}

function githubSessionMatchesLogin(session: VSCodeGitHubAuthSession, login: string): boolean {
  return session.account?.label === login || session.account?.id === login;
}

function githubSessionAccessToken(session: VSCodeGitHubAuthSession): string | undefined {
  return typeof session.accessToken === "string" && session.accessToken.trim() ? session.accessToken.trim() : undefined;
}

async function buildCredentialFromLocalVSCode(userDataDir?: string | null): Promise<{ credential: string; login: string; dbPath: string }> {
  const dataRoot = resolveVSCodeDataRoot(userDataDir);
  const loginInfo = await readLocalCopilotLogin(dataRoot);
  if (!loginInfo) {
    throw new GatewayError("NOT_FOUND", "No local VS Code GitHub Copilot login was found", 404);
  }
  const sessions = await readGitHubAuthSessions(dataRoot);
  const token = githubSessionAccessToken(
    sessions?.find((session) => githubSessionMatchesLogin(session, loginInfo.login) && githubSessionAccessToken(session)) ?? {}
  );
  if (!token) {
    throw new GatewayError("NOT_FOUND", `No GitHub auth session matched VS Code Copilot login ${loginInfo.login}`, 404);
  }
  return {
    credential: await buildGitHubCopilotCredentialFromAccessToken(token),
    login: loginInfo.login,
    dbPath: loginInfo.dbPath
  };
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: GITHUB_OAUTH_CLIENT_ID,
    scope: GITHUB_OAUTH_SCOPE
  });
  const response = await fetchWithProxy(GITHUB_DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": APP_USER_AGENT
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GatewayError(
      "GITHUB_COPILOT_AUTH_ERROR",
      `GitHub device code request failed (${response.status}): ${trimText(text)}`,
      401
    );
  }
  try {
    return JSON.parse(text) as DeviceCodeResponse;
  } catch {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub device code endpoint returned invalid JSON", 401);
  }
}

async function exchangeDeviceToken(session: GitHubCopilotOAuthSession): Promise<DeviceTokenResponse> {
  const body = new URLSearchParams({
    client_id: GITHUB_OAUTH_CLIENT_ID,
    device_code: session.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code"
  });
  const response = await fetchWithProxy(GITHUB_DEVICE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": APP_USER_AGENT
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GatewayError(
      "GITHUB_COPILOT_AUTH_ERROR",
      `GitHub device token request failed (${response.status}): ${trimText(text)}`,
      401
    );
  }
  try {
    return JSON.parse(text) as DeviceTokenResponse;
  } catch {
    throw new GatewayError("GITHUB_COPILOT_AUTH_ERROR", "GitHub device token endpoint returned invalid JSON", 401);
  }
}

async function pollSession(session: GitHubCopilotOAuthSession): Promise<void> {
  if (session.status !== "pending" || isExpired(session) || Date.now() < session.nextPollAt) {
    return;
  }

  const response = await exchangeDeviceToken(session);
  if (response.access_token) {
    session.credential = await buildGitHubCopilotCredentialFromAccessToken(response.access_token);
    session.status = "authorized";
    session.message = "GitHub authorization received. CherryAPI can now save the Copilot account.";
    return;
  }

  switch (response.error) {
    case "authorization_pending":
      session.message = "Waiting for GitHub device authorization.";
      session.nextPollAt = Date.now() + session.intervalMs;
      return;
    case "slow_down":
      session.intervalMs += 5000;
      session.message = "GitHub asked CherryAPI to slow down polling.";
      session.nextPollAt = Date.now() + session.intervalMs;
      return;
    case "expired_token":
      session.status = "expired";
      session.error = "expired_token";
      session.message = "GitHub device authorization expired.";
      return;
    case "access_denied":
      session.status = "cancelled";
      session.error = "access_denied";
      session.message = "GitHub authorization was cancelled.";
      return;
    default:
      if (response.error) {
        session.status = "failed";
        session.error = response.error;
        session.message = response.error_description ?? response.error;
      } else {
        session.nextPollAt = Date.now() + session.intervalMs;
      }
  }
}

async function createGitHubCopilotAccountFromCredential(
  session: Pick<GitHubCopilotOAuthSession, "channelMode" | "channelId" | "channel" | "accountDefaults">,
  credential: string
) {
  parseGitHubCopilotCredential(credential);
  const response = await createPlatformAccount("github_copilot", {
    loginMethodId: "copilot_credential_json",
    channelMode: session.channelMode,
    channelId: session.channelId,
    channel: session.channel,
    account: {
      name: session.accountDefaults.name,
      auth_type: "github_copilot_oauth",
      credential,
      tags: session.accountDefaults.tags,
      weight: session.accountDefaults.weight,
      concurrency_limit: session.accountDefaults.concurrencyLimit,
      status: session.accountDefaults.status,
      health_status: "healthy"
    }
  });
  return response;
}

export async function startGitHubCopilotOAuth(input: unknown) {
  const body = bodyObject(input ?? {});
  const device = await requestDeviceCode();
  const id = createId("ghcp_oauth");
  const now = Date.now();
  const expiresIn = Math.max(1, Math.min(device.expires_in ?? OAUTH_TIMEOUT_SECONDS, OAUTH_TIMEOUT_SECONDS));
  const session: GitHubCopilotOAuthSession = {
    id,
    deviceCode: device.device_code,
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete,
    status: "pending",
    message: `Open GitHub device authorization and enter code ${device.user_code}.`,
    createdAt: now,
    expiresAt: now + expiresIn * 1000,
    intervalMs: Math.max(1, device.interval ?? 5) * 1000,
    nextPollAt: now,
    channelMode: channelModeValue(body.channelMode ?? body.channel_mode ?? "auto_create"),
    channelId: optionalString(body, "channelId", "channel_id") ?? undefined,
    channel: body.channel,
    accountDefaults: parseAccountDefaults(body.accountDefaults ?? body.account_defaults)
  };
  sessions.set(id, session);
  return {
    sessionId: id,
    authUrl: session.verificationUriComplete ?? session.verificationUri,
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    verificationUriComplete: session.verificationUriComplete,
    expiresAt: expiresIso(session),
    instructions: session.message
  };
}

export async function getGitHubCopilotOAuthStatus(sessionId: string) {
  const session = getSession(sessionId);
  try {
    await pollSession(session);
  } catch (error) {
    session.status = "failed";
    session.error = toSafeErrorMessage(error);
    session.message = session.error;
  }
  return sessionView(session);
}

export async function completeGitHubCopilotOAuth(input: unknown) {
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
    const fallbackToken = optionalString(body, "credential");
    const credential = fallbackToken
      ? await buildGitHubCopilotCredentialFromAccessToken(fallbackToken)
      : session.credential;
    if (fallbackToken) {
      session.status = "authorized";
      session.message = "GitHub access token accepted. CherryAPI can now save the Copilot account.";
    }
    if (!credential) {
      await pollSession(session);
    }
    const nextCredential = credential ?? session.credential;
    if (!nextCredential || session.status !== "authorized") {
      throw new GatewayError("VALIDATION_ERROR", "GitHub device authorization has not completed yet", 400);
    }

    const response = await createGitHubCopilotAccountFromCredential(session, nextCredential);
    session.status = "completed";
    session.message = "GitHub Copilot credential saved.";
    session.account = response.account;
    session.channelRecord = response.channel;
    session.credentialSummary = response.account.credentialSummary;
    session.credential = undefined;
    return {
      ...response,
      credentialSummary: session.credentialSummary
    };
  } catch (error) {
    session.status = "failed";
    session.error = toSafeErrorMessage(error);
    session.message = session.error;
    throw error;
  }
}

export async function cancelGitHubCopilotOAuth(input: unknown) {
  const body = bodyObject(input);
  const session = getSession(stringValue(body, "sessionId", "session_id"));
  session.status = "cancelled";
  session.message = "GitHub Copilot OAuth session cancelled.";
  session.credential = undefined;
  return sessionView(session);
}

export async function createGitHubCopilotAccountWithToken(input: unknown) {
  const body = bodyObject(input);
  const credentialInput = stringValue(body, "credential", "github_access_token");
  const credential = await buildGitHubCopilotCredentialFromAccessToken(credentialInput);
  const accountInput = bodyObject(body.account);
  const defaults = parseAccountDefaults(accountInput);
  return createGitHubCopilotAccountFromCredential(
    {
      channelMode: channelModeValue(body.channelMode ?? body.channel_mode ?? "auto_create"),
      channelId: optionalString(body, "channelId", "channel_id") ?? undefined,
      channel: body.channel,
      accountDefaults: {
        ...defaults,
        name: stringValue(accountInput, "name", "name", defaults.name)
      }
    },
    credential
  );
}

export async function importGitHubCopilotAccountFromLocalVSCode(input: unknown) {
  const body = bodyObject(input ?? {});
  const local = await buildCredentialFromLocalVSCode(optionalString(body, "userDataDir", "user_data_dir") ?? undefined);
  const defaults = parseAccountDefaults(body.accountDefaults ?? body.account_defaults ?? body.account);
  return createGitHubCopilotAccountFromCredential(
    {
      channelMode: channelModeValue(body.channelMode ?? body.channel_mode ?? "auto_create"),
      channelId: optionalString(body, "channelId", "channel_id") ?? undefined,
      channel: body.channel,
      accountDefaults: defaults
    },
    local.credential
  );
}

export async function refreshGitHubCopilotAccount(accountId: string) {
  const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) {
    throw new GatewayError("NOT_FOUND", "Account not found", 404);
  }
  const credential = await refreshGitHubCopilotCredential(decryptSecret(account.credentialEncrypted));
  await db
    .update(accounts)
    .set({
      credentialEncrypted: encryptSecret(credential),
      healthStatus: "healthy",
      lastError: null,
      lastSuccessAt: nowIso(),
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, accountId));
  return getAccount(accountId);
}
