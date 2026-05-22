import type {
  AdapterCapabilities,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse
} from "@cherryapi/shared";
import { GatewayError } from "../core/errors";
import type { AccountRecord } from "../database/schema";
import type { AdapterContext, ProviderAdapter, UpstreamRequest, UpstreamResponse } from "./types";

export abstract class SkeletonAdapter implements ProviderAdapter {
  constructor(public readonly type: string) {}

  getCapabilities(): AdapterCapabilities {
    return {
      chatCompletions: true,
      streaming: true,
      tools: true,
      responses: false
    };
  }

  async transformRequest(
    _input: OpenAIChatCompletionRequest,
    _context: AdapterContext
  ): Promise<UpstreamRequest> {
    throw new GatewayError("NOT_IMPLEMENTED", `${this.type} adapter is not implemented yet`, 501);
  }

  async send(
    _request: UpstreamRequest,
    _account: AccountRecord,
    _context: AdapterContext
  ): Promise<UpstreamResponse> {
    throw new GatewayError("NOT_IMPLEMENTED", `${this.type} adapter is not implemented yet`, 501);
  }

  async transformResponse(
    _response: UpstreamResponse,
    _context: AdapterContext
  ): Promise<OpenAIChatCompletionResponse> {
    throw new GatewayError("NOT_IMPLEMENTED", `${this.type} adapter is not implemented yet`, 501);
  }

  async *transformStream(
    _response: UpstreamResponse,
    _context: AdapterContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    throw new GatewayError("NOT_IMPLEMENTED", `${this.type} adapter is not implemented yet`, 501);
  }
}
