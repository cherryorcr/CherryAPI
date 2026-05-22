import { eq } from "drizzle-orm";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import { db } from "../database/client";
import { appSettings, type AccountRecord } from "../database/schema";

const GLOBAL_PROXY_KEY = "global_proxy";
const proxyAgents = new Map<string, ProxyAgent>();

export interface GlobalProxyConfig {
  enabled: boolean;
  proxyUrl: string | null;
  source: "manual" | "detected" | "env" | "disabled";
  lastCheckedAt: string | null;
  lastStatus: "available" | "unavailable" | "unknown";
  lastError: string | null;
}

const defaultProxyConfig: GlobalProxyConfig = {
  enabled: false,
  proxyUrl: null,
  source: "disabled",
  lastCheckedAt: null,
  lastStatus: "unknown",
  lastError: null
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeProxyUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "direct") {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function proxySource(value: unknown): GlobalProxyConfig["source"] {
  if (value === "manual" || value === "detected" || value === "env" || value === "disabled") {
    return value;
  }
  return "manual";
}

function proxyStatus(value: unknown): GlobalProxyConfig["lastStatus"] {
  if (value === "available" || value === "unavailable" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function parseProxyConfig(value: unknown): GlobalProxyConfig {
  if (!isPlainObject(value)) {
    return defaultProxyConfig;
  }

  return {
    enabled: value.enabled === true,
    proxyUrl: normalizeProxyUrl(typeof value.proxyUrl === "string" ? value.proxyUrl : typeof value.proxy_url === "string" ? value.proxy_url : null),
    source: proxySource(value.source),
    lastCheckedAt:
      typeof value.lastCheckedAt === "string"
        ? value.lastCheckedAt
        : typeof value.last_checked_at === "string"
          ? value.last_checked_at
          : null,
    lastStatus: proxyStatus(value.lastStatus ?? value.last_status),
    lastError:
      typeof value.lastError === "string"
        ? value.lastError
        : typeof value.last_error === "string"
          ? value.last_error
          : null
  };
}

export async function getGlobalProxyConfig(): Promise<GlobalProxyConfig> {
  const setting = await db.select().from(appSettings).where(eq(appSettings.key, GLOBAL_PROXY_KEY)).get();
  return setting ? parseProxyConfig(setting.value) : defaultProxyConfig;
}

export async function setGlobalProxyConfig(config: Partial<GlobalProxyConfig>): Promise<GlobalProxyConfig> {
  const current = await getGlobalProxyConfig();
  const next: GlobalProxyConfig = {
    ...current,
    ...config,
    proxyUrl: normalizeProxyUrl(config.proxyUrl === undefined ? current.proxyUrl : config.proxyUrl)
  };
  if (!next.enabled) {
    next.source = "disabled";
  }
  const value: Record<string, unknown> = { ...next };

  await db
    .insert(appSettings)
    .values({
      key: GLOBAL_PROXY_KEY,
      value,
      updatedAt: new Date().toISOString()
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value,
        updatedAt: new Date().toISOString()
      }
    });

  return next;
}

function agentForProxy(proxyUrl: string): ProxyAgent {
  const existing = proxyAgents.get(proxyUrl);
  if (existing) {
    return existing;
  }
  const agent = new ProxyAgent(proxyUrl);
  proxyAgents.set(proxyUrl, agent);
  return agent;
}

async function globalProxyUrl(): Promise<string | null> {
  const config = await getGlobalProxyConfig();
  return config.enabled ? config.proxyUrl : null;
}

export async function fetchWithProxy(
  input: string | URL,
  init: RequestInit = {},
  options: { proxyUrl?: string | null } = {}
): Promise<Response> {
  const proxyUrl = options.proxyUrl === undefined ? await globalProxyUrl() : normalizeProxyUrl(options.proxyUrl);
  const dispatcher = proxyUrl ? agentForProxy(proxyUrl) : undefined;
  const requestInit = {
    ...init,
    ...(dispatcher ? { dispatcher } : {})
  } as RequestInit & { dispatcher?: Dispatcher };
  return undiciFetch(input, requestInit as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

export async function fetchWithAccountProxy(
  input: string | URL,
  init: RequestInit,
  account: AccountRecord
): Promise<Response> {
  const accountProxy = normalizeProxyUrl(account.proxy);
  return fetchWithProxy(input, init, accountProxy ? { proxyUrl: accountProxy } : {});
}
