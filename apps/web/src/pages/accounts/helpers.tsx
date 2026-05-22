import { Clock, KeyRound, Plug, Upload } from "lucide-react";
import type { ChannelPresetDefinition, ChannelTemplateDefinition, LoginMethodDefinition, PlatformId } from "@cherryapi/shared";
import type {
  AccountCredentialSummary,
  AccountModelCapabilityRecord,
  AccountModelDetectionProgress,
  AccountRecord,
  ChannelRecord,
  DetectedAccountModel,
  PlatformRecord,
  PlatformSummary
} from "../../types/admin";
import { asJsonText, formatDate, parseJson, tagsFromText, toNullableNumber, toNullableString, toNumber } from "../helpers";
import type { AccountFormState, ChannelFormState, PlatformSelection } from "./types";

export const QUOTA_AUTO_REFRESH_MAX_AGE_MS = 10 * 60 * 1000;

export const emptyAccount: AccountFormState = {
  platformId: "all",
  channelMode: "use_existing",
  channelPresetId: "custom",
  channelId: "",
  channelName: "",
  channelProvider: "",
  channelAdapterType: "",
  channelProtocol: "",
  channelStatus: "enabled",
  name: "",
  authType: "api_key",
  credential: "",
  proxy: "",
  tags: "normal",
  weight: "1",
  concurrencyLimit: "5",
  status: "enabled",
  healthStatus: "healthy",
  quotaLimit: "",
  cooldownUntil: "",
  channelBaseUrl: "",
  candidateModels: "",
  channelConfig: "{}"
};

export function channelPlatformId(channel: ChannelRecord): PlatformId {
  const adapterType = channel.adapterType.trim().toLowerCase();
  const provider = channel.provider.trim().toLowerCase();
  const protocol = channel.protocol.trim().toLowerCase();
  const name = channel.name.trim().toLowerCase();
  const haystack = [adapterType, provider, protocol, name].join(" ");

  if (adapterType === "codex" || haystack.includes("codex")) return "codex";
  if (adapterType === "antigravity" || provider === "antigravity") return "antigravity";
  if (haystack.includes("github_copilot") || haystack.includes("copilot")) return "github_copilot";
  if (haystack.includes("windsurf")) return "windsurf";
  if (haystack.includes("kiro")) return "kiro";
  if (haystack.includes("cursor")) return "cursor";
  if (adapterType === "gemini" || provider === "google" || haystack.includes("gemini")) return "gemini_cli";
  if (haystack.includes("codebuddy_cn") || haystack.includes("codebuddy cn")) return "codebuddy_cn";
  if (haystack.includes("codebuddy")) return "codebuddy";
  if (haystack.includes("qoder")) return "qoder";
  if (haystack.includes("trae")) return "trae";
  if (haystack.includes("zed")) return "zed";
  if (adapterType === "claude_api" || adapterType === "claude_oauth" || provider === "anthropic") return "claude";
  if (adapterType === "openai_api" || adapterType === "chatgpt_oauth") return "openai";
  return "openai_compatible";
}

export function candidateModelsText(channel?: ChannelRecord): string {
  const configured = channel?.config?.candidateModels ?? channel?.config?.candidate_models;
  if (Array.isArray(configured)) {
    return configured.filter((item): item is string => typeof item === "string").join(", ");
  }
  return typeof configured === "string" ? configured : "";
}

export function candidateModelsTextFromConfig(config: Record<string, unknown> | undefined): string {
  const configured = config?.candidateModels ?? config?.candidate_models;
  if (Array.isArray(configured)) {
    return configured.filter((item): item is string => typeof item === "string").join("\n");
  }
  return typeof configured === "string" ? configured : "";
}

export function openAuthWindow(authUrl: string | null | undefined): boolean {
  if (!authUrl) {
    return false;
  }
  const loginWindow = window.open(authUrl, "_blank");
  if (loginWindow) {
    loginWindow.opener = null;
  }
  return Boolean(loginWindow);
}

export function normalizedChannelConfig(configText: string, _candidateModels: string): Record<string, unknown> {
  const parsed = parseJson(configText, "channel config");
  const config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  delete config.candidateModels;
  delete config.candidate_models;
  return config;
}

export function templateWithPreset(
  platform: PlatformRecord | undefined,
  preset?: ChannelPresetDefinition
): ChannelTemplateDefinition | undefined {
  const template = platform?.defaultChannelTemplate;
  if (!template && !preset?.channel) {
    return undefined;
  }
  return {
    name: preset?.channel.name ?? template?.name ?? platform?.name ?? "",
    provider: preset?.channel.provider ?? template?.provider ?? platform?.channelProvider ?? "",
    adapterType: preset?.channel.adapterType ?? template?.adapterType ?? platform?.defaultAdapterType ?? "",
    protocol: preset?.channel.protocol ?? template?.protocol ?? platform?.defaultProtocol ?? "",
    baseUrl: preset?.channel.baseUrl ?? template?.baseUrl ?? null,
    status: preset?.channel.status ?? template?.status ?? "enabled",
    capabilities: {
      ...(template?.capabilities ?? {}),
      ...(preset?.channel.capabilities ?? {})
    },
    config: {
      ...(template?.config ?? {}),
      ...(preset?.channel.config ?? {})
    }
  };
}

export function platformSlug(platform?: PlatformRecord): string {
  return (platform?.id ?? "account").replace(/_/g, "-");
}

export function createDetectionRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `detect_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `detect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function initialDetectionProgress(account: AccountRecord, requestId: string): AccountModelDetectionProgress {
  const now = new Date().toISOString();
  return {
    requestId,
    accountId: account.id,
    channelId: account.channelId,
    status: "listing",
    total: null,
    completed: 0,
    currentModel: null,
    startedAt: now,
    updatedAt: now,
    error: null
  };
}

export function detectionProgressStatusText(status: AccountModelDetectionProgress["status"]): string {
  if (status === "listing") return "Fetching upstream model list";
  if (status === "testing") return "Testing models";
  if (status === "completed") return "Sync completed";
  return "Sync failed";
}

export function defaultAuthType(method?: LoginMethodDefinition, platformId?: PlatformSelection): string {
  if (!method) {
    return "api_key";
  }
  if (platformId === "codex" && method.id === "codex_oauth_json") {
    return "codex_oauth";
  }
  if (platformId === "codex" && method.id === "access_token") {
    return "codex_access_token";
  }
  if (platformId === "github_copilot" && method.id === "copilot_credential_json") {
    return "github_copilot_oauth";
  }
  if (platformId === "github_copilot" && method.id === "github_access_token") {
    return "github_access_token";
  }
  if (method.type === "api_key") return "api_key";
  if (method.type === "refresh_token") return "refresh_token";
  if (method.type === "manual_token") return "manual_token";
  if (method.type === "json_import") return "json";
  return method.type;
}

export function defaultTags(platformId: PlatformSelection): string {
  if (platformId === "codex") {
    return "coding, normal";
  }
  if (platformId === "github_copilot") {
    return "coding, normal";
  }
  return "normal";
}

export function defaultConcurrency(platformId: PlatformSelection): string {
  return platformId === "codex" || platformId === "github_copilot" ? "1" : "5";
}

export function formWithChannel(form: AccountFormState, channel?: ChannelRecord): AccountFormState {
  return {
    ...form,
    channelId: channel?.id ?? "",
    channelName: channel?.name ?? form.channelName,
    channelProvider: channel?.provider ?? form.channelProvider,
    channelAdapterType: channel?.adapterType ?? form.channelAdapterType,
    channelProtocol: channel?.protocol ?? form.channelProtocol,
    channelStatus: channel?.status ?? form.channelStatus,
    channelBaseUrl: channel?.baseUrl ?? "",
    candidateModels: candidateModelsText(channel),
    channelConfig: channel ? asJsonText(channel.config) : form.channelConfig
  };
}

export function formWithChannelTemplate(form: AccountFormState, template?: ChannelTemplateDefinition): AccountFormState {
  if (!template) {
    return form;
  }
  const config = template.config ?? {};
  return {
    ...form,
    channelName: template.name,
    channelProvider: template.provider,
    channelAdapterType: template.adapterType,
    channelProtocol: template.protocol,
    channelStatus: template.status ?? "enabled",
    channelBaseUrl: template.baseUrl ?? "",
    candidateModels: candidateModelsTextFromConfig(config),
    channelConfig: asJsonText(config)
  };
}

export function fromAccount(account: AccountRecord, channel?: ChannelRecord): AccountFormState {
  return formWithChannel(
    {
      ...emptyAccount,
      id: account.id,
      platformId: channel ? channelPlatformId(channel) : "all",
      channelId: account.channelId,
      name: account.name,
      authType: account.authType,
      credential: "",
      proxy: account.proxy ?? "",
      tags: account.tags.join(", "),
      weight: String(account.weight),
      concurrencyLimit: String(account.concurrencyLimit),
      status: account.status,
      healthStatus: account.healthStatus,
      quotaLimit: account.quotaLimit === null ? "" : String(account.quotaLimit),
      cooldownUntil: account.cooldownUntil ?? ""
    },
    channel
  );
}

export function credentialLabel(form: AccountFormState): string {
  if (form.id) {
    return "Credential (leave blank to keep)";
  }
  if (form.loginMethodType === "api_key") return "API Key";
  if (form.loginMethodType === "json_import") return "Credential JSON";
  if (form.loginMethodType === "refresh_token") return "Refresh Token";
  if (form.platformId === "github_copilot" && form.loginMethodId === "github_access_token") return "GitHub Access Token";
  if (form.loginMethodType === "manual_token") return "Access Token";
  return "Credential";
}

export function methodIcon(method: LoginMethodDefinition) {
  if (method.type === "api_key" || method.type === "manual_token" || method.type === "refresh_token") {
    return <KeyRound size={16} />;
  }
  if (method.type === "json_import" || method.type === "local_import") {
    return <Upload size={16} />;
  }
  if (method.type === "plugin_sync") {
    return <Plug size={16} />;
  }
  return <Clock size={16} />;
}

export function jsonCredentialSummary(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "JSON must be an object.";
    }
    const record = parsed as Record<string, unknown>;
    const hasAccessToken = Boolean(record.access_token ?? record.accessToken ?? record.token);
    const hasGitHubAccessToken = Boolean(record.github_access_token ?? record.githubAccessToken);
    const hasCopilotToken = Boolean(record.copilot_token ?? record.copilotToken);
    const hasRefreshToken = Boolean(record.refresh_token ?? record.refreshToken);
    const accountId = record.account_id ?? record.accountId;
    const githubLogin = record.github_login ?? record.githubLogin;
    const chatgptAccountId = record.chatgpt_account_id ?? record.chatgptAccountId;
    const email = record.email ?? record.github_email ?? record.githubEmail ?? record.account_email ?? record.user_email;
    return [
      hasAccessToken ? "access token present" : null,
      hasGitHubAccessToken ? "GitHub token present" : null,
      hasCopilotToken ? "Copilot token present" : null,
      hasRefreshToken ? "refresh token present" : null,
      typeof accountId === "string" ? `account ${accountId}` : null,
      typeof githubLogin === "string" ? githubLogin : null,
      typeof chatgptAccountId === "string" ? `chatgpt ${chatgptAccountId}` : null,
      typeof email === "string" ? email : null
    ]
      .filter(Boolean)
      .join(" | ") || "valid JSON object";
  } catch {
    return "Invalid JSON.";
  }
}

export function credentialSummaryText(summary?: AccountCredentialSummary): string {
  if (!summary) {
    return "unknown";
  }
  const details = [
    summary.email,
    summary.accountId,
    summary.chatgptAccountId ? `chatgpt ${summary.chatgptAccountId}` : null,
    summary.hasAccessToken ? "access token" : null,
    summary.hasRefreshToken ? "refresh token" : null,
    summary.expired === true ? "expired" : null,
    summary.expired === false && summary.expiredAt ? `expires ${formatDate(summary.expiredAt)}` : null
  ].filter(Boolean);
  return details.length ? `${summary.kind}: ${details.join(", ")}` : summary.kind;
}

export function accountModelCounts(accountId: string, capabilities: AccountModelCapabilityRecord[]) {
  const accountModels = capabilities.filter((capability) => capability.accountId === accountId);
  return {
    total: accountModels.length,
    available: accountModels.filter((capability) => capability.status === "available").length
  };
}

export function modelName(model: DetectedAccountModel): string {
  return model.upstreamModelName;
}

export function sourceLabel(source?: string): string {
  if (source === "upstream_list" || source === "detected") return "Upstream list";
  if (source === "candidate_probe" || source === "candidate") return "Candidate probe";
  if (source === "manual") return "Manual";
  return source || "Unknown";
}

export function accountIdentity(summary?: AccountCredentialSummary): string {
  if (!summary) {
    return "credential unknown";
  }
  return summary.email ?? summary.accountId ?? summary.chatgptAccountId ?? credentialSummaryText(summary);
}

export function summaryForAll(summaries: PlatformSummary[]): PlatformSummary {
  return {
    id: "openai_compatible",
    name: "All",
    implementationStatus: summaries.some((summary) => summary.implementationStatus !== "available") ? "partial" : "available",
    accountsTotal: summaries.reduce((total, summary) => total + summary.accountsTotal, 0),
    healthyAccounts: summaries.reduce((total, summary) => total + summary.healthyAccounts, 0),
    degradedAccounts: summaries.reduce((total, summary) => total + summary.degradedAccounts, 0),
    disabledAccounts: summaries.reduce((total, summary) => total + summary.disabledAccounts, 0),
    channelsTotal: summaries.reduce((total, summary) => total + summary.channelsTotal, 0),
    supportedLoginMethods: []
  };
}

export function channelPayloadFromForm(form: AccountFormState): Record<string, unknown> {
  return {
    name: form.channelName,
    provider: form.channelProvider,
    adapter_type: form.channelAdapterType,
    protocol: form.channelProtocol,
    base_url: toNullableString(form.channelBaseUrl),
    status: form.channelStatus,
    capabilities: {},
    config: normalizedChannelConfig(form.channelConfig, form.candidateModels)
  };
}

export function accountPayloadFromForm(form: AccountFormState): Record<string, unknown> {
  return {
    name: form.name,
    auth_type: form.authType,
    credential: form.credential.trim(),
    proxy: toNullableString(form.proxy),
    tags: tagsFromText(form.tags),
    weight: toNumber(form.weight, "weight", 1),
    concurrency_limit: toNumber(form.concurrencyLimit, "concurrency_limit", 5),
    status: form.status,
    health_status: form.healthStatus,
    quota_limit: toNullableNumber(form.quotaLimit, "quota_limit"),
    cooldown_until: toNullableString(form.cooldownUntil)
  };
}

export function channelFormFromTemplate(platformId: PlatformId, template: ChannelTemplateDefinition): ChannelFormState {
  return {
    id: undefined,
    platformId,
    name: template.name,
    provider: template.provider,
    adapterType: template.adapterType,
    protocol: template.protocol,
    baseUrl: template.baseUrl ?? "",
    status: template.status ?? "enabled",
    candidateModels: candidateModelsTextFromConfig(template.config),
    config: asJsonText(template.config ?? {})
  };
}

export function channelFormFromChannel(channel: ChannelRecord): ChannelFormState {
  const platformId = channelPlatformId(channel);
  return {
    id: channel.id,
    platformId,
    name: channel.name,
    provider: channel.provider,
    adapterType: channel.adapterType,
    protocol: channel.protocol,
    baseUrl: channel.baseUrl ?? "",
    status: channel.status,
    candidateModels: candidateModelsText(channel),
    config: asJsonText(channel.config)
  };
}

export function channelPayloadFromChannelForm(form: ChannelFormState): Record<string, unknown> {
  return {
    name: form.name,
    provider: form.provider,
    adapter_type: form.adapterType,
    protocol: form.protocol,
    base_url: toNullableString(form.baseUrl),
    status: form.status,
    capabilities: {},
    config: normalizedChannelConfig(form.config, form.candidateModels)
  };
}
