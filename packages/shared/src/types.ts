export type EntityStatus = "enabled" | "disabled";
export type HealthStatus = "healthy" | "degraded" | "disabled";
export type AdapterType =
  | "openai_compatible"
  | "openai_api"
  | "claude_api"
  | "claude_oauth"
  | "chatgpt_oauth"
  | "codex"
  | "github_copilot"
  | "gemini"
  | "antigravity";

export interface AdapterCapabilities {
  chatCompletions: boolean;
  streaming: boolean;
  tools: boolean;
  responses: boolean;
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<Record<string, unknown>>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<Record<string, unknown>>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  [key: string]: unknown;
}

export interface OpenAIModelList {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
}
