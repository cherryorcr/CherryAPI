import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { fetchWithProxy, getGlobalProxyConfig, normalizeProxyUrl, setGlobalProxyConfig } from "../../core/proxy-fetch";
import { bodyObject, booleanValue, jsonValue, numberValue, optionalString, stringValue } from "../common/body";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEFAULT_TIMEOUT_MS = 8000;

const COMMON_LOCAL_PROXY_PORTS = [
  7890,
  7897,
  7898,
  7899,
  7891,
  1080,
  10808,
  20171,
  2080,
  8080
];
const COMMON_LOCAL_PROXY_HOSTS = ["127.0.0.1", "localhost", "host.docker.internal"];

export interface ProxyDetectionResult {
  proxyUrl: string | null;
  label: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
  responsePreview: string | null;
}

function envProxyUrls(): string[] {
  return [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy
  ]
    .map((value) => normalizeProxyUrl(value))
    .filter((value): value is string => Boolean(value));
}

function defaultCandidates(): string[] {
  return [
    ...envProxyUrls(),
    ...COMMON_LOCAL_PROXY_PORTS.flatMap((port) => COMMON_LOCAL_PROXY_HOSTS.map((host) => `http://${host}:${port}`))
  ];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function bodyOrEmpty(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) {
    return {};
  }
  return bodyObject(input);
}

function unsupportedRegion(text: string): boolean {
  return text.includes("unsupported_country_region_territory") || /country.+region.+territory.+not supported/i.test(text);
}

function trimText(text: string, length = 500): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function detectionBody(): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: "cherryapi-proxy-detection-invalid-code",
    redirect_uri: CODEX_REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: "cherryapi-proxy-detection-invalid-verifier"
  });
}

async function testProxy(proxyUrl: string | null, timeoutMs: number): Promise<ProxyDetectionResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchWithProxy(
      CODEX_TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: detectionBody(),
        signal: AbortSignal.timeout(timeoutMs)
      },
      { proxyUrl }
    );
    const text = await response.text().catch(() => "");
    const blocked = unsupportedRegion(text);
    const ok = !blocked && response.status < 500 && response.status !== 403;
    return {
      proxyUrl,
      label: proxyUrl ?? "Direct",
      ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: ok ? null : blocked ? "OpenAI rejected this route as unsupported country/region/territory." : `HTTP ${response.status}`,
      responsePreview: trimText(text) || null
    };
  } catch (error) {
    return {
      proxyUrl,
      label: proxyUrl ?? "Direct",
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: toSafeErrorMessage(error),
      responsePreview: null
    };
  }
}

export async function getProxyConfig() {
  return getGlobalProxyConfig();
}

export async function putProxyConfig(input: unknown) {
  const body = bodyObject(input);
  const enabled = booleanValue(body, "enabled", "enabled", false);
  const proxyUrl = optionalString(body, "proxyUrl", "proxy_url") ?? null;
  if (enabled && !normalizeProxyUrl(proxyUrl)) {
    throw new GatewayError("VALIDATION_ERROR", "proxy_url is required when proxy is enabled", 400);
  }

  return setGlobalProxyConfig({
    enabled,
    proxyUrl,
    source: enabled ? "manual" : "disabled",
    lastStatus: "unknown",
    lastError: null
  });
}

export async function detectProxies(input?: unknown) {
  const body = bodyOrEmpty(input);
  const timeoutMs = numberValue(body, "timeoutMs", "timeout_ms", DEFAULT_TIMEOUT_MS);
  const apply = booleanValue(body, "apply", "apply", true);
  const includeDirect = booleanValue(body, "includeDirect", "include_direct", true);
  const configured = await getGlobalProxyConfig();
  const rawCandidates = jsonValue(body, "candidates", "candidates", []) as unknown;
  const bodyCandidates = Array.isArray(rawCandidates)
    ? rawCandidates.map((item) => (typeof item === "string" ? normalizeProxyUrl(item) : null)).filter((item): item is string => Boolean(item))
    : [];
  const candidates = unique([
    ...(configured.proxyUrl ? [configured.proxyUrl] : []),
    ...bodyCandidates,
    ...defaultCandidates()
  ]);
  const testTargets: Array<string | null> = [...candidates];
  if (includeDirect) {
    testTargets.unshift(null);
  }

  const results = await Promise.all(testTargets.map((candidate) => testProxy(candidate, timeoutMs)));
  const best = results.find((result) => result.ok && result.proxyUrl);
  const direct = results.find((result) => result.proxyUrl === null);
  let config = configured;

  if (apply && best) {
    config = await setGlobalProxyConfig({
      enabled: true,
      proxyUrl: best.proxyUrl,
      source: "detected",
      lastCheckedAt: new Date().toISOString(),
      lastStatus: "available",
      lastError: null
    });
  } else if (apply && !best) {
    config = await setGlobalProxyConfig({
      ...configured,
      lastCheckedAt: new Date().toISOString(),
      lastStatus: direct?.ok ? "available" : "unavailable",
      lastError: results.find((result) => !result.ok)?.error ?? "No usable proxy candidate was detected."
    });
  }

  return {
    active: config,
    applied: apply && Boolean(best),
    best,
    direct,
    results
  };
}
