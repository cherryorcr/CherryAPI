import type { AdapterCapabilities, LoginMethodDefinition, PlatformDefinition, PlatformId } from "@cherryapi/shared";

export type JsonObject = Record<string, unknown>;

export interface ChannelRecord {
  id: string;
  name: string;
  provider: string;
  adapterType: string;
  protocol: string;
  baseUrl: string | null;
  status: string;
  priority: number;
  weight: number;
  capabilities: Partial<AdapterCapabilities> & JsonObject;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRecord {
  id: string;
  channelId: string;
  name: string;
  authType: string;
  proxy: string | null;
  tags: string[];
  weight: number;
  concurrencyLimit: number;
  currentConcurrency: number;
  status: string;
  healthStatus: string;
  quotaLimit: number | null;
  quotaUsed: number;
  quotaSnapshot: AccountQuotaSnapshot | null;
  quotaCheckedAt: string | null;
  quotaLastError: string | null;
  quotaLastErrorAt: string | null;
  cooldownUntil: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasCredential: boolean;
  credentialSummary?: AccountCredentialSummary;
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
}

export interface AccountCredentialSummary {
  kind: "api_key" | "oauth_json" | "access_token" | "refresh_token" | "unknown";
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  accountId?: string;
  chatgptAccountId?: string;
  email?: string;
  expired?: boolean;
  expiredAt?: string;
  scopes?: string[];
}

export type PlatformRecord = PlatformDefinition;

export interface PlatformSummary {
  id: PlatformId;
  name: string;
  implementationStatus: "available" | "partial" | "planned";
  accountsTotal: number;
  healthyAccounts: number;
  degradedAccounts: number;
  disabledAccounts: number;
  channelsTotal: number;
  supportedLoginMethods: LoginMethodDefinition[];
}

export interface ModelRecord {
  id: string;
  publicName: string;
  displayName: string;
  description: string | null;
  capabilities: Partial<AdapterCapabilities> & JsonObject;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRouteRecord {
  id: string;
  modelId: string;
  channelId: string;
  upstreamModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
  fallbackOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountModelCapabilityRecord {
  id: string;
  accountId: string;
  channelId: string;
  upstreamModelName: string;
  displayName: string | null;
  status: "available" | "unavailable" | "unknown";
  capabilities: JsonObject;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
  source: string;
  verifiedByTest: boolean;
  discoveryMode: string;
  discoverySource: string | null;
  warnings: string[];
  raw: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface AccountModelAliasRecord {
  id: string;
  accountId: string;
  publicModel: string;
  upstreamModelName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DetectedAccountModel {
  upstreamModelName: string;
  displayName?: string;
  capabilities?: JsonObject;
  source?: "upstream_list" | "candidate_probe" | "detected" | "candidate" | "manual";
}

export interface AccountModelListResponse {
  requestId: string;
  accountId: string;
  channelId: string;
  listError: string | null;
  models: DetectedAccountModel[];
  account?: AccountRecord;
  channel?: ChannelRecord;
  platformId?: string;
  discovery?: {
    mode: "upstream_list" | "candidate_probe" | "mixed" | "none";
    listSupported: boolean;
    upstreamListCount: number;
    candidateProbeCount: number;
    verifiedByTest: boolean;
  };
  warnings?: string[];
}

export interface AccountModelDetectionResponse {
  requestId: string;
  accountId: string;
  channelId: string;
  listError: string | null;
  discovery?: {
    mode: "upstream_list" | "candidate_probe" | "mixed" | "none";
    listSupported: boolean;
    upstreamListCount: number;
    candidateProbeCount: number;
    verifiedByTest: boolean;
  };
  warnings?: string[];
  capabilities: AccountModelCapabilityRecord[];
  account?: AccountRecord;
  channel?: ChannelRecord;
  platformId?: string;
  summary?: {
    total: number;
    available: number;
    unavailable: number;
    unknown: number;
    durationMs: number;
  };
  models?: AccountModelCapabilityRecord[];
}

export interface AccountModelDetectionProgress {
  requestId: string;
  accountId: string | null;
  channelId: string | null;
  status: "listing" | "testing" | "completed" | "failed";
  total: number | null;
  completed: number;
  currentModel: string | null;
  startedAt: string;
  updatedAt: string;
  error: string | null;
}

export interface CreateModelRouteFromCapabilityResponse {
  model: ModelRecord;
  route: ModelRouteRecord;
  created: {
    model: boolean;
    route: boolean;
  };
}

export interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupModelPermissionRecord {
  id: string;
  groupId: string;
  modelId: string;
  enabled: boolean;
  rpmLimit: number | null;
  tpmLimit: number | null;
  dailyQuota: number | null;
  priceMultiplier: number;
}

export interface GroupChannelPermissionRecord {
  id: string;
  groupId: string;
  channelId: string;
  enabled: boolean;
}

export interface GroupAccountRuleRecord {
  id: string;
  groupId: string;
  channelId: string;
  allowedTags: string[];
  blockedTags: string[];
  allowedAccountIds: string[];
  blockedAccountIds: string[];
}

export interface GroupModelBindingRecord {
  id: string;
  groupId: string;
  publicModel: string;
  upstreamModelName: string;
  channelId: string;
  accountId: string;
  source: "detected" | "account_alias" | "group_custom" | string;
  enabled: boolean;
  priority: number;
  accountPriority: number;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupModelCandidate {
  accountId: string;
  accountName: string;
  channelId: string;
  channelName: string;
  upstreamModel: string;
  source: "detected" | "account_alias" | "group_custom";
  capabilityId: string | null;
  discoveryMode: string | null;
  discoverySource: string | null;
  selected: boolean;
  enabled: boolean;
  bindingId: string | null;
  priority: number;
  accountPriority: number;
  weight: number;
  available: boolean;
  stale: boolean;
  staleReason: string | null;
  lastCheckedAt: string | null;
}

export interface GroupModelCandidateGroup {
  publicModel: string;
  sources: Array<"detected" | "account_alias" | "group_custom">;
  candidates: GroupModelCandidate[];
}

export interface GroupModelCandidatesResponse {
  group: GroupRecord;
  allowedChannelIds: string[];
  accountRules: GroupAccountRuleRecord[];
  matchedAccounts: AccountRecord[];
  models: GroupModelCandidateGroup[];
  bindings: GroupModelBindingRecord[];
}

export interface GroupEffectiveModelsResponse {
  group: GroupRecord;
  allowedChannelIds: string[];
  accountRules: GroupAccountRuleRecord[];
  effectiveAccounts: AccountRecord[];
  effectiveUpstreamModels: Array<{
    upstreamModelName: string;
    displayName: string | null;
    channelIds: string[];
    accountIds: string[];
    lastCheckedAt: string | null;
  }>;
  exposedPublicModels: Array<{
    id: string;
    publicName: string;
    displayName: string;
    status: string;
  }>;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  groupId: string;
  status: string;
  quotaLimit: number | null;
  quotaUsed: number;
  rpmLimit: number | null;
  tpmLimit: number | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyCreateResponse extends ApiKeyRecord {
  key: string;
}

export interface UsageLogRecord {
  id: string;
  requestId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string | null;
  groupId: string | null;
  modelId: string | null;
  channelId: string | null;
  channelName: string | null;
  accountId: string | null;
  accountName: string | null;
  requestModel: string;
  upstreamModel: string | null;
  status: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number;
  totalTokens: number;
  enabledAccounts: number;
  healthyAccounts: number;
  degradedAccounts: number;
  disabledAccounts: number;
}

export interface ChannelHealthRecord {
  channelId: string;
  channelName: string;
  totalAccounts: number;
  healthy: number;
  degraded: number;
  disabled: number;
  cooldown: number;
}

export interface AdminTestResponse {
  requestId: string;
  model: string;
  content: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  latencyMs: number;
  response: unknown;
}

export interface HealthResponse {
  status: "ok";
  adapters: Array<{
    type: string;
    capabilities: AdapterCapabilities;
  }>;
  counts: {
    channels: number;
    accounts: number;
    healthyAccounts: number;
    usageLogs: number;
  };
  successRate: number;
}

export interface GlobalProxyConfig {
  enabled: boolean;
  proxyUrl: string | null;
  source: "manual" | "detected" | "env" | "disabled";
  lastCheckedAt: string | null;
  lastStatus: "available" | "unavailable" | "unknown";
  lastError: string | null;
}

export interface ProxyDetectionResult {
  proxyUrl: string | null;
  label: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
  responsePreview: string | null;
}

export interface ProxyDetectionResponse {
  active: GlobalProxyConfig;
  applied: boolean;
  best?: ProxyDetectionResult;
  direct?: ProxyDetectionResult;
  results: ProxyDetectionResult[];
}
