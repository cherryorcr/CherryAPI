import type { OpenAIChatCompletionRequest } from "@cherryapi/shared";
import { buildOpenAIApiUpstreamBody } from "../adapters/openai-api.adapter";
import { chatCompletionsUrl, stringifyUpstreamBody } from "../adapters/openai-compatible.adapter";

function readArg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? process.env[name.toUpperCase()];
  if (!value && fallback === undefined) {
    throw new Error(`Missing --${name}=...`);
  }
  return value ?? fallback!;
}

const baseUrl = readArg("base-url", "https://api.openai.com/v1");
const upstreamModel = readArg("upstream-model");
const model = readArg("model", "openai-gpt");
const stream = readArg("stream", "false") === "true";
const message = readArg("message", "hello from CherryAPI OpenAI API debug script");

const input: OpenAIChatCompletionRequest = {
  model,
  stream,
  messages: [
    {
      role: "user",
      content: message
    }
  ],
  temperature: 0.2,
  cherryapi_internal_debug: true
};

const upstreamUrl = chatCompletionsUrl(baseUrl);
const upstreamBody = buildOpenAIApiUpstreamBody(input, upstreamModel, stream);
const upstreamBodyJson = stringifyUpstreamBody(upstreamBody);

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      upstreamUrl,
      headers: {
        Authorization: "[redacted]",
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json"
      },
      upstreamBodyJson
    },
    null,
    2
  )
);
