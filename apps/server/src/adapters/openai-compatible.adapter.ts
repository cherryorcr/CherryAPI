import type {
  AdapterCapabilities,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse
} from "@cherryapi/shared";
import { GatewayError, toSafeErrorMessage } from "../core/errors";
import { fetchWithAccountProxy } from "../core/proxy-fetch";
import { decryptSecret } from "../utils/crypto";
import { env } from "../utils/env";
import type { AccountRecord, ChannelRecord } from "../database/schema";
import type {
  AdapterContext,
  AdapterDetectionContext,
  DetectedModel,
  ModelTestResult,
  ProviderAdapter,
  UpstreamRequest,
  UpstreamResponse
} from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function chatCompletionsUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    throw new GatewayError("NO_AVAILABLE_ROUTE", "Channel base_url is required", 400);
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}

export function openAIModelsUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    throw new GatewayError("NO_AVAILABLE_ROUTE", "Channel base_url is required", 400);
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/models")) {
    return trimmed;
  }

  if (trimmed.endsWith("/chat/completions")) {
    return `${trimmed.slice(0, -"/chat/completions".length)}/models`;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/models`;
  }

  return `${trimmed}/v1/models`;
}

export function openAIResponsesUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    throw new GatewayError("NO_AVAILABLE_ROUTE", "Channel base_url is required", 400);
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) {
    return trimmed;
  }

  if (trimmed.endsWith("/chat/completions")) {
    return `${trimmed.slice(0, -"/chat/completions".length)}/responses`;
  }

  if (trimmed.endsWith("/models")) {
    return `${trimmed.slice(0, -"/models".length)}/responses`;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/responses`;
  }

  return `${trimmed}/v1/responses`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeJsonValue(value: unknown, path: string): JsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    throw new GatewayError("VALIDATION_ERROR", `${path} cannot be serialized as JSON`, 400);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeJsonValue(item, `${path}[${index}]`) ?? null);
  }

  if (!isPlainObject(value)) {
    throw new GatewayError("VALIDATION_ERROR", `${path} must be a plain JSON value`, 400);
  }

  const output: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeJsonValue(child, `${path}.${key}`);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }
  return output;
}

export function buildOpenAICompatibleUpstreamBody(
  input: OpenAIChatCompletionRequest,
  upstreamModelName: string,
  stream: boolean
): Record<string, unknown> {
  const sanitized = sanitizeJsonValue(input, "body");
  if (!isPlainObject(sanitized)) {
    throw new GatewayError("VALIDATION_ERROR", "Upstream body must be a plain JSON object", 400);
  }

  return {
    ...sanitized,
    model: upstreamModelName,
    stream
  };
}

export function stringifyUpstreamBody(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function previewBody(body: Record<string, unknown>): string {
  const preview = stringifyUpstreamBody(body);
  return preview.length > 1200 ? `${preview.slice(0, 1200)}...` : preview;
}

function debugLog(message: string, payload: Record<string, unknown>): void {
  if (env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug(`[OpenAICompatibleAdapter] ${message}`, payload);
  }
}

function errorLog(message: string, payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[OpenAICompatibleAdapter] ${message}`, payload);
}

async function upstreamError(response: Response, context: AdapterContext): Promise<GatewayError> {
  const text = await response.text().catch(() => "");
  const message = text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  errorLog("upstream non-2xx response", {
    requestId: context.requestId,
    status: response.status,
    adapter_type: context.channel.adapterType,
    requestModel: context.model.publicName,
    upstreamModel: context.upstreamModelName,
    responseText: message
  });
  return new GatewayError(
    "UPSTREAM_ERROR",
    message || `Upstream returned HTTP ${response.status}`,
    response.status >= 400 && response.status < 500 ? 502 : 503
  );
}

async function detectionError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const message = text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  return message || `Upstream returned HTTP ${response.status}`;
}

function detectedCapabilities(channel: ChannelRecord, adapter: ProviderAdapter): Record<string, unknown> {
  return {
    ...adapter.getCapabilities(),
    ...(channel.capabilities ?? {}),
    chatCompletions: true
  };
}

interface OpenAIModelProbeCheck {
  ok: boolean;
  endpoint: "chat" | "stream" | "responses";
  url: string;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

async function probeOpenAIModelEndpoint(
  account: AccountRecord,
  url: string,
  apiKey: string,
  endpoint: OpenAIModelProbeCheck["endpoint"],
  body: Record<string, unknown>,
  accept: string
): Promise<OpenAIModelProbeCheck> {
  const startedAt = Date.now();
  try {
    const response = await fetchWithAccountProxy(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: accept,
        Authorization: `Bearer ${apiKey}`
      },
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
        error: await detectionError(response)
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

function firstProbeError(checks: OpenAIModelProbeCheck[]): string | null {
  return checks
    .map((check) => check.error)
    .find((error): error is string => Boolean(error)) ?? null;
}

export async function probeOpenAIModelCapabilities({
  account,
  channel,
  adapter,
  apiKey,
  upstreamModelName,
  baseUrl
}: {
  account: AccountRecord;
  channel: ChannelRecord;
  adapter: ProviderAdapter;
  apiKey: string;
  upstreamModelName: string;
  baseUrl: string | null;
}): Promise<ModelTestResult> {
  const startedAt = Date.now();
  const chatUrl = chatCompletionsUrl(baseUrl);
  const responsesUrl = openAIResponsesUrl(baseUrl);
  const chatBody = {
    model: upstreamModelName,
    messages: [{ role: "user", content: "ping" }],
    stream: false
  };
  const streamBody = {
    ...chatBody,
    stream: true
  };
  const responsesBody = {
    model: upstreamModelName,
    input: "ping",
    max_output_tokens: 8,
    stream: false
  };

  const [chat, stream, responses] = await Promise.all([
    probeOpenAIModelEndpoint(account, chatUrl, apiKey, "chat", chatBody, "application/json"),
    probeOpenAIModelEndpoint(account, chatUrl, apiKey, "stream", streamBody, "text/event-stream"),
    probeOpenAIModelEndpoint(account, responsesUrl, apiKey, "responses", responsesBody, "application/json")
  ]);
  const checks = { chatCompletions: chat, streaming: stream, responses };
  const available = chat.ok || stream.ok;
  const baseCapabilities = detectedCapabilities(channel, adapter);

  return {
    status: available ? "available" : "unavailable",
    capabilities: {
      ...baseCapabilities,
      chatCompletions: chat.ok,
      streaming: stream.ok,
      responses: responses.ok,
      checks
    },
    latencyMs: Date.now() - startedAt,
    error: available ? null : firstProbeError([chat, stream, responses])
  };
}

function modelDisplayName(model: unknown): string | undefined {
  if (!model || typeof model !== "object") {
    return undefined;
  }
  const record = model as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : undefined;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  type = "openai_compatible";

  getCapabilities(): AdapterCapabilities {
    return {
      chatCompletions: true,
      streaming: true,
      tools: true,
      responses: false
    };
  }

  async transformRequest(
    input: OpenAIChatCompletionRequest,
    context: AdapterContext
  ): Promise<UpstreamRequest> {
    const body = buildOpenAICompatibleUpstreamBody(input, context.upstreamModelName, context.stream);
    const bodyJson = stringifyUpstreamBody(body);
    const url = chatCompletionsUrl(context.channel.baseUrl);

    debugLog("prepared upstream request", {
      requestId: context.requestId,
      upstreamUrl: url,
      adapter_type: context.channel.adapterType,
      requestModel: input.model,
      upstreamModel: context.upstreamModelName,
      stream: context.stream,
      upstreamBodyPreview: previewBody(body)
    });

    return {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: context.stream ? "text/event-stream" : "application/json"
      },
      body,
      bodyJson,
      stream: context.stream
    };
  }

  async send(
    request: UpstreamRequest,
    account: AccountRecord,
    context: AdapterContext
  ): Promise<UpstreamResponse> {
    const apiKey = decryptSecret(account.credentialEncrypted);
    const bodyJson = request.bodyJson;
    JSON.parse(bodyJson);

    const response = await fetchWithAccountProxy(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${apiKey}`
      },
      body: bodyJson
    }, account);

    if (!response.ok) {
      throw await upstreamError(response, context);
    }

    return {
      status: response.status,
      headers: response.headers,
      raw: response
    };
  }

  async transformResponse(
    response: UpstreamResponse,
    context: AdapterContext
  ): Promise<OpenAIChatCompletionResponse> {
    const data = (await response.raw.json()) as OpenAIChatCompletionResponse;
    return {
      ...data,
      model: context.model.publicName
    };
  }

  async *transformStream(
    response: UpstreamResponse,
    context: AdapterContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    if (!response.raw.body) {
      throw new GatewayError("UPSTREAM_ERROR", "Upstream response did not include a stream body", 502);
    }

    const reader = response.raw.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? "";

        for (const event of parts) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith("data:")) {
              continue;
            }

            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") {
              if (data === "[DONE]") {
                return;
              }
              continue;
            }

            const parsed = JSON.parse(data) as OpenAIChatCompletionChunk;
            yield {
              ...parsed,
              model: context.model.publicName
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(
    account: AccountRecord,
    channel: ChannelRecord,
    _context: AdapterDetectionContext
  ): Promise<DetectedModel[]> {
    const apiKey = decryptSecret(account.credentialEncrypted);
    const response = await fetchWithAccountProxy(openAIModelsUrl(channel.baseUrl), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    }, account);

    if (!response.ok) {
      throw new GatewayError("UPSTREAM_ERROR", await detectionError(response), 502);
    }

    const data = (await response.json()) as { data?: unknown[] };
    const capabilities = detectedCapabilities(channel, this);
    return (Array.isArray(data.data) ? data.data : [])
      .map((model) => modelDisplayName(model))
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        upstreamModelName: id,
        displayName: id,
        capabilities,
        source: "upstream_list"
      }));
  }

  async testModel(
    account: AccountRecord,
    channel: ChannelRecord,
    upstreamModelName: string,
    _context: AdapterDetectionContext
  ): Promise<ModelTestResult> {
    const apiKey = decryptSecret(account.credentialEncrypted);
    return probeOpenAIModelCapabilities({
      account,
      channel,
      adapter: this,
      apiKey,
      upstreamModelName,
      baseUrl: channel.baseUrl
    });
  }
}
