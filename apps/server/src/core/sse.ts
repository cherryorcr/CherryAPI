import type { OpenAIChatCompletionChunk } from "@cherryapi/shared";

export function encodeSseData(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

export async function* encodeOpenAIStream(
  chunks: AsyncIterable<OpenAIChatCompletionChunk>
): AsyncIterable<string> {
  for await (const chunk of chunks) {
    yield encodeSseData(chunk);
  }
  yield encodeSseData("[DONE]");
}
