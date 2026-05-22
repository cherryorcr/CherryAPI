import type {
  AdapterCapabilities,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse
} from "@cherryapi/shared";
import type {
  AccountRecord,
  ApiKeyRecord,
  ChannelRecord,
  GroupRecord,
  ModelRecord,
  ModelRouteRecord
} from "../database/schema";

export interface AdapterContext {
  requestId: string;
  apiKey: ApiKeyRecord;
  group: GroupRecord;
  model: ModelRecord;
  route: ModelRouteRecord;
  channel: ChannelRecord;
  account: AccountRecord;
  upstreamModelName: string;
  stream: boolean;
}

export interface AdapterDetectionContext {
  requestId: string;
}

export interface DetectedModel {
  upstreamModelName: string;
  displayName?: string;
  capabilities?: Record<string, unknown>;
  source?: "upstream_list" | "candidate_probe" | "detected" | "candidate" | "manual";
}

export interface ModelTestResult {
  status: "available" | "unavailable" | "unknown";
  capabilities?: Record<string, unknown>;
  latencyMs?: number;
  error?: string | null;
}

export interface AccountQuotaMetric {
  id: string;
  label: string;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  resetAt?: string | null;
  included?: boolean;
  unlimited?: boolean;
  raw?: unknown;
}

export interface AccountQuotaSnapshot {
  provider: string;
  checkedAt: string;
  plan?: string | null;
  metrics: AccountQuotaMetric[];
  summary?: {
    usedPercent?: number | null;
    remainingPercent?: number | null;
  };
  raw?: unknown;
}

export interface UpstreamRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Record<string, unknown>;
  bodyJson: string;
  stream: boolean;
}

export interface UpstreamResponse {
  status: number;
  headers: Headers;
  raw: Response;
}

export interface ProviderAdapter {
  type: string;
  getCapabilities(): AdapterCapabilities;
  transformRequest(
    input: OpenAIChatCompletionRequest,
    context: AdapterContext
  ): Promise<UpstreamRequest>;
  send(
    request: UpstreamRequest,
    account: AccountRecord,
    context: AdapterContext
  ): Promise<UpstreamResponse>;
  transformResponse(
    response: UpstreamResponse,
    context: AdapterContext
  ): Promise<OpenAIChatCompletionResponse>;
  transformStream?(
    response: UpstreamResponse,
    context: AdapterContext
  ): AsyncIterable<OpenAIChatCompletionChunk>;
  listModels?(
    account: AccountRecord,
    channel: ChannelRecord,
    context: AdapterDetectionContext
  ): Promise<DetectedModel[]>;
  testModel?(
    account: AccountRecord,
    channel: ChannelRecord,
    upstreamModelName: string,
    context: AdapterDetectionContext
  ): Promise<ModelTestResult>;
  checkQuota?(
    account: AccountRecord,
    channel: ChannelRecord,
    context: AdapterDetectionContext
  ): Promise<AccountQuotaSnapshot>;
}
