import type { OpenAIChatCompletionRequest } from "@cherryapi/shared";
import { buildClaudeMessagesBody, claudeMessagesUrl } from "../adapters/claude.adapter";
import { stringifyUpstreamBody } from "../adapters/openai-compatible.adapter";

function readArg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? process.env[name.toUpperCase()];
  if (!value && fallback === undefined) {
    throw new Error(`Missing --${name}=...`);
  }
  return value ?? fallback!;
}

const baseUrl = readArg("base-url", "https://api.anthropic.com/v1");
const upstreamModel = readArg("upstream-model");
const model = readArg("model", "claude-sonnet");
const prompt = readArg("prompt", "hello from CherryAPI Claude debug script");
const maxTokens = Number(readArg("max-tokens", "1024"));
const stream = readArg("stream", "false") === "true";

const input: OpenAIChatCompletionRequest = {
  model,
  stream,
  max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1024,
  messages: [
    {
      role: "system",
      content: "You are a concise assistant."
    },
    {
      role: "user",
      content: prompt
    }
  ],
  temperature: 0.2
};

const upstreamUrl = claudeMessagesUrl(baseUrl);
const upstreamBody = buildClaudeMessagesBody(input, upstreamModel, stream);
const upstreamBodyJson = stringifyUpstreamBody(upstreamBody);

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      upstreamUrl,
      headers: {
        "x-api-key": "[redacted]",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json"
      },
      upstreamBodyJson
    },
    null,
    2
  )
);
