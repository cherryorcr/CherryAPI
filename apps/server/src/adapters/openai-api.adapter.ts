import type {
  AdapterCapabilities,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse
} from "@cherryapi/shared";
import { GatewayError } from "../core/errors";
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
import {
  chatCompletionsUrl,
  openAIModelsUrl,
  probeOpenAIModelCapabilities,
  stringifyUpstreamBody
} from "./openai-compatible.adapter";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const OPENAI_CHAT_ALLOWED_FIELDS = new Set([
  "messages",
  "temperature",
  "top_p",
  "max_tokens",
  "tools",
  "tool_choice",
  "stream",
  "response_format",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "stop",
  "n",
  "user",
  "logprobs",
  "top_logprobs",
  "parallel_tool_calls"
]);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

export function buildOpenAIApiUpstreamBody(
  input: OpenAIChatCompletionRequest,
  upstreamModelName: string,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: upstreamModelName,
    stream
  };

  for (const [key, value] of Object.entries(input)) {
    if (key === "model" || key === "stream" || key.startsWith("cherryapi_")) {
      continue;
    }
    if (!OPENAI_CHAT_ALLOWED_FIELDS.has(key)) {
      continue;
    }
    const sanitized = sanitizeJsonValue(value, `body.${key}`);
    if (sanitized !== undefined) {
      body[key] = sanitized;
    }
  }

  return body;
}

function openAIChatCompletionsUrl(baseUrl: string | null): string {
  return chatCompletionsUrl(baseUrl ?? DEFAULT_OPENAI_BASE_URL);
}

function openAIModelListUrl(baseUrl: string | null): string {
  return openAIModelsUrl(baseUrl ?? DEFAULT_OPENAI_BASE_URL);
}

function previewBody(body: Record<string, unknown>): string {
  const preview = stringifyUpstreamBody(body);
  return preview.length > 1200 ? `${preview.slice(0, 1200)}...` : preview;
}

function debugLog(message: string, payload: Record<string, unknown>): void {
  if (env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug(`[OpenAIApiAdapter] ${message}`, payload);
  }
}

function errorLog(message: string, payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[OpenAIApiAdapter] ${message}`, payload);
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
    message || `OpenAI API returned HTTP ${response.status}`,
    response.status >= 400 && response.status < 500 ? 502 : 503
  );
}

async function detectionError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const message = text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  return message || `OpenAI API returned HTTP ${response.status}`;
}

function detectedCapabilities(channel: ChannelRecord, adapter: ProviderAdapter): Record<string, unknown> {
  return {
    ...adapter.getCapabilities(),
    ...(channel.capabilities ?? {}),
    chatCompletions: true
  };
}

function modelDisplayName(model: unknown): string | undefined {
  if (!model || typeof model !== "object") {
    return undefined;
  }
  const record = model as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : undefined;
}

export class OpenAIApiAdapter implements ProviderAdapter {
  type = "openai_api";

  getCapabilities(): AdapterCapabilities {
    return {
      chatCompletions: true,
      streaming: true,
      tools: true,
      responses: true
    };
  }

  async transformRequest(input: OpenAIChatCompletionRequest, context: AdapterContext): Promise<UpstreamRequest> {
    const body = buildOpenAIApiUpstreamBody(input, context.upstreamModelName, context.stream);
    const bodyJson = stringifyUpstreamBody(body);
    const url = openAIChatCompletionsUrl(context.channel.baseUrl);

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

  async send(request: UpstreamRequest, account: AccountRecord, context: AdapterContext): Promise<UpstreamResponse> {
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

  async transformResponse(response: UpstreamResponse, context: AdapterContext): Promise<OpenAIChatCompletionResponse> {
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
      throw new GatewayError("UPSTREAM_ERROR", "OpenAI API response did not include a stream body", 502);
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
    const response = await fetchWithAccountProxy(openAIModelListUrl(channel.baseUrl), {
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
      baseUrl: channel.baseUrl ?? DEFAULT_OPENAI_BASE_URL
    });
  }
}
