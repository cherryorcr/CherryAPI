import type { OpenAIChatCompletionRequest } from "@cherryapi/shared";
import {
  buildCodexResponsesBody,
  buildSanitizedCodexHeaders,
  codexResponsesUrl,
  stringifyCodexBody
} from "../adapters/codex.adapter";

function readArg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? process.env[name.toUpperCase()];
  if (!value && fallback === undefined) {
    throw new Error(`Missing --${name}=...`);
  }
  return value ?? fallback!;
}

const baseUrl = readArg("base-url", "https://chatgpt.com/backend-api/codex");
const upstreamModel = readArg("upstream-model");
const model = readArg("model", "codex-coding");
const stream = readArg("stream", "false") === "true";
const prompt = readArg("prompt", readArg("message", "hello codex"));
const hasChatGptAccountId = readArg("chatgpt-account-id", "") !== "";

const input: OpenAIChatCompletionRequest = {
  model,
  stream,
  messages: [
    {
      role: "user",
      content: prompt
    }
  ]
};

const upstreamUrl = codexResponsesUrl(baseUrl);
const upstreamBody = buildCodexResponsesBody(input, upstreamModel);
const upstreamBodyJson = stringifyCodexBody(upstreamBody);

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      upstreamUrl,
      headers: buildSanitizedCodexHeaders(hasChatGptAccountId),
      upstreamBody,
      upstreamBodyJson,
      clientStream: stream,
      upstreamStream: true
    },
    null,
    2
  )
);
