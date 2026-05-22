import type { OpenAIChatCompletionRequest } from "@cherryapi/shared";
import {
  buildOpenAICompatibleUpstreamBody,
  chatCompletionsUrl,
  stringifyUpstreamBody
} from "../adapters/openai-compatible.adapter";

function readArg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? process.env[name.toUpperCase()];
  if (!value && fallback === undefined) {
    throw new Error(`Missing --${name}=...`);
  }
  return value ?? fallback!;
}

const baseUrl = readArg("base-url");
const upstreamModel = readArg("upstream-model");
const model = readArg("model", "debug-model");
const stream = readArg("stream", "false") === "true";
const message = readArg("message", "hello from CherryAPI debug script");

const input: OpenAIChatCompletionRequest = {
  model,
  stream,
  messages: [
    {
      role: "user",
      content: message
    }
  ]
};

const upstreamUrl = chatCompletionsUrl(baseUrl);
const upstreamBody = buildOpenAICompatibleUpstreamBody(input, upstreamModel, stream);
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
