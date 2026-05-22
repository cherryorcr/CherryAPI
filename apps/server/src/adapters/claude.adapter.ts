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
import type { AccountRecord } from "../database/schema";
import type { AdapterContext, ProviderAdapter, UpstreamRequest, UpstreamResponse } from "./types";
import { stringifyUpstreamBody } from "./openai-compatible.adapter";

const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

type ClaudeRole = "user" | "assistant";
type ClaudeContentBlock = { type: "text"; text: string };

interface ClaudeMessage {
  role: ClaudeRole;
  content: string;
}

type ClaudeMessagesBody = Record<string, unknown> & {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  stream?: boolean;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
};

interface ClaudeResponse {
  id?: string;
  content?: Array<ClaudeContentBlock | Record<string, unknown>>;
  model?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ClaudeStreamPayload {
  type?: string;
  message?: ClaudeResponse;
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function claudeMessagesUrl(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? DEFAULT_CLAUDE_BASE_URL).replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractOpenAITextContent(content: unknown, path: string): string {
  if (typeof content === "string") {
    return content;
  }

  if (content === null || content === undefined) {
    return "";
  }

  if (!Array.isArray(content)) {
    throw new GatewayError("CLAUDE_UNSUPPORTED_CONTENT_TYPE", `${path} must be text content`, 400);
  }

  return content
    .map((part, index) => {
      if (!isPlainObject(part)) {
        throw new GatewayError("CLAUDE_UNSUPPORTED_CONTENT_TYPE", `${path}[${index}] must be an object`, 400);
      }

      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      if (part.type === "image_url") {
        throw new GatewayError("CLAUDE_UNSUPPORTED_CONTENT_TYPE", "Claude adapter does not support image_url content yet", 400);
      }

      throw new GatewayError(
        "CLAUDE_UNSUPPORTED_CONTENT_TYPE",
        `Claude adapter does not support content part type ${String(part.type ?? "unknown")}`,
        400
      );
    })
    .join("");
}

function appendClaudeMessage(messages: ClaudeMessage[], role: ClaudeRole, content: string): void {
  const normalized = content.trim().length ? content : " ";
  const previous = messages[messages.length - 1];
  if (previous?.role === role) {
    previous.content = `${previous.content}\n\n${normalized}`;
    return;
  }
  messages.push({ role, content: normalized });
}

function normalizeStop(stop: unknown): string[] | undefined {
  if (typeof stop === "string" && stop.length > 0) {
    return [stop];
  }
  if (Array.isArray(stop)) {
    const values = stop.filter((item): item is string => typeof item === "string" && item.length > 0);
    return values.length ? values : undefined;
  }
  return undefined;
}

export function buildClaudeMessagesBody(
  input: OpenAIChatCompletionRequest,
  upstreamModelName: string,
  stream: boolean
): ClaudeMessagesBody {
  if (input.tools && input.tools.length > 0) {
    throw new GatewayError("CLAUDE_UNSUPPORTED_CONTENT_TYPE", "Claude adapter does not support OpenAI tool definitions yet", 400);
  }

  const systemParts: string[] = [];
  const messages: ClaudeMessage[] = [];

  input.messages.forEach((message, index) => {
    const content = extractOpenAITextContent(message.content, `messages[${index}].content`);
    if (message.role === "system") {
      if (content.trim().length) {
        systemParts.push(content);
      }
      return;
    }

    if (message.role === "user" || message.role === "assistant") {
      appendClaudeMessage(messages, message.role, content);
      return;
    }

    throw new GatewayError("CLAUDE_UNSUPPORTED_CONTENT_TYPE", `Claude adapter does not support ${message.role} messages yet`, 400);
  });

  if (messages.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "Claude requires at least one user or assistant message", 400);
  }

  const body: ClaudeMessagesBody = {
    model: upstreamModelName,
    max_tokens: Math.max(1, Math.floor(asFiniteNumber(input.max_tokens) ?? 1024)),
    messages,
    stream
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const temperature = asFiniteNumber(input.temperature);
  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const topP = asFiniteNumber(input.top_p);
  if (topP !== undefined) {
    body.top_p = topP;
  }

  const stopSequences = normalizeStop(input.stop);
  if (stopSequences) {
    body.stop_sequences = stopSequences;
  }

  return body;
}

function claudeTextFromContent(content: ClaudeResponse["content"]): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function mapFinishReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}

function usageFromClaude(usage: ClaudeResponse["usage"]): NonNullable<OpenAIChatCompletionResponse["usage"]> {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

function previewBody(body: Record<string, unknown>): string {
  const preview = stringifyUpstreamBody(body);
  return preview.length > 1200 ? `${preview.slice(0, 1200)}...` : preview;
}

function debugLog(message: string, payload: Record<string, unknown>): void {
  if (env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug(`[ClaudeAdapter] ${message}`, payload);
  }
}

function errorLog(message: string, payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[ClaudeAdapter] ${message}`, payload);
}

function parseClaudeError(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    // Fall through to raw text.
  }
  return text || `Claude API returned HTTP ${status}`;
}

async function upstreamError(response: Response, context: AdapterContext): Promise<GatewayError> {
  const text = await response.text().catch(() => "");
  const preview = text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  const message = parseClaudeError(text, response.status);
  errorLog("upstream non-2xx response", {
    requestId: context.requestId,
    status: response.status,
    adapter_type: context.channel.adapterType,
    requestModel: context.model.publicName,
    upstreamModel: context.upstreamModelName,
    responseText: preview
  });
  return new GatewayError(
    "CLAUDE_UPSTREAM_ERROR",
    message,
    response.status >= 400 && response.status < 500 ? 502 : 503
  );
}

function parseSseBlock(block: string): ClaudeStreamPayload | undefined {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const data = dataLines.join("\n").trim();
  if (!data) {
    return undefined;
  }

  try {
    return JSON.parse(data) as ClaudeStreamPayload;
  } catch {
    throw new GatewayError("CLAUDE_STREAM_ERROR", "Claude stream returned invalid JSON", 502);
  }
}

function chunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: NonNullable<OpenAIChatCompletionChunk["usage"]>
): OpenAIChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason
      }
    ],
    usage: usage ?? null
  };
}

export class ClaudeAdapter implements ProviderAdapter {
  constructor(public readonly type = "claude_api") {}

  getCapabilities(): AdapterCapabilities {
    return {
      chatCompletions: true,
      streaming: true,
      tools: false,
      responses: false
    };
  }

  async transformRequest(input: OpenAIChatCompletionRequest, context: AdapterContext): Promise<UpstreamRequest> {
    const body = buildClaudeMessagesBody(input, context.upstreamModelName, context.stream);
    const bodyJson = stringifyUpstreamBody(body);
    const url = claudeMessagesUrl(context.channel.baseUrl);

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
        Accept: context.stream ? "text/event-stream" : "application/json",
        "anthropic-version": ANTHROPIC_VERSION
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
        "x-api-key": apiKey
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
    const data = (await response.raw.json()) as ClaudeResponse;
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const id = data.id ?? `chatcmpl-${context.requestId}`;

    return {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: context.model.publicName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: claudeTextFromContent(data.content)
          },
          finish_reason: mapFinishReason(data.stop_reason)
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  }

  async *transformStream(response: UpstreamResponse, context: AdapterContext): AsyncIterable<OpenAIChatCompletionChunk> {
    if (!response.raw.body) {
      throw new GatewayError("CLAUDE_STREAM_ERROR", "Claude response did not include a stream body", 502);
    }

    const reader = response.raw.body.getReader();
    const decoder = new TextDecoder();
    const created = Math.floor(Date.now() / 1000);
    const publicModel = context.model.publicName;
    let buffer = "";
    let streamId = `chatcmpl-${context.requestId}`;
    let promptTokens = 0;
    let completionTokens = 0;
    let emittedFinish = false;

    const finalUsage = (): NonNullable<OpenAIChatCompletionChunk["usage"]> => ({
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    });

    const handlePayload = function* (payload: ClaudeStreamPayload): Generator<OpenAIChatCompletionChunk> {
      switch (payload.type) {
        case "message_start": {
          if (payload.message?.id) {
            streamId = payload.message.id;
          }
          promptTokens = payload.message?.usage?.input_tokens ?? promptTokens;
          return;
        }
        case "content_block_delta": {
          if (payload.delta?.type === "text_delta" && typeof payload.delta.text === "string" && payload.delta.text.length) {
            yield chunk(streamId, created, publicModel, { content: payload.delta.text }, null);
          }
          return;
        }
        case "message_delta": {
          completionTokens = payload.usage?.output_tokens ?? completionTokens;
          if (payload.delta?.stop_reason) {
            emittedFinish = true;
            yield chunk(streamId, created, publicModel, {}, mapFinishReason(payload.delta.stop_reason), finalUsage());
          }
          return;
        }
        case "message_stop": {
          if (!emittedFinish) {
            emittedFinish = true;
            yield chunk(streamId, created, publicModel, {}, "stop", finalUsage());
          }
          return;
        }
        case "error": {
          const message = payload.error?.message ?? "Claude stream returned an error";
          throw new GatewayError("CLAUDE_STREAM_ERROR", message, 502);
        }
        default:
          return;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const payload = parseSseBlock(part);
          if (!payload) {
            continue;
          }
          yield* handlePayload(payload);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const payload = parseSseBlock(buffer);
        if (payload) {
          yield* handlePayload(payload);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
