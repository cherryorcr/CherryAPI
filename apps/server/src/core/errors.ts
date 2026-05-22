export type GatewayErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_ALLOWED"
  | "NO_AVAILABLE_ROUTE"
  | "CHANNEL_NOT_ALLOWED"
  | "NO_AVAILABLE_ACCOUNT"
  | "ADAPTER_NOT_FOUND"
  | "CLAUDE_UPSTREAM_ERROR"
  | "CLAUDE_UNSUPPORTED_CONTENT_TYPE"
  | "CLAUDE_STREAM_ERROR"
  | "CODEX_UPSTREAM_ERROR"
  | "CODEX_AUTH_ERROR"
  | "CODEX_STREAM_ERROR"
  | "CODEX_UNSUPPORTED_CONTENT_TYPE"
  | "CODEX_MODEL_NOT_AVAILABLE"
  | "CODEX_OAUTH_PORT_IN_USE"
  | "CODEX_OAUTH_CALLBACK_ERROR"
  | "GITHUB_COPILOT_AUTH_ERROR"
  | "GITHUB_COPILOT_UPSTREAM_ERROR"
  | "UPSTREAM_ERROR"
  | "NOT_IMPLEMENTED";

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof GatewayError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  }

  return "Unknown error";
}
