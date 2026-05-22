import {
  PLATFORM_DEFINITIONS,
  getPlatformDefinition,
  inferPlatformIdFromChannel,
  type ChannelTemplateDefinition,
  type PlatformDefinition,
  type PlatformId
} from "@cherryapi/shared";
import { db } from "../../database/client";
import { accounts, channels, type AccountRecord, type ChannelRecord } from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { createAccount, sanitizeAccount } from "../accounts/accounts.service";
import { createChannel, getChannel } from "../channels/channels.service";
import {
  bodyObject,
  jsonValue,
  numberValue,
  optionalJsonValue,
  optionalNumber,
  optionalString,
  stringValue
} from "../common/body";

export interface PlatformSummary {
  id: PlatformId;
  name: string;
  implementationStatus: PlatformDefinition["implementationStatus"];
  accountsTotal: number;
  healthyAccounts: number;
  degradedAccounts: number;
  disabledAccounts: number;
  channelsTotal: number;
  supportedLoginMethods: PlatformDefinition["supportedLoginMethods"];
}

type ChannelMode = "use_existing" | "create_new" | "auto_create";

function platformIdForChannel(channel: ChannelRecord): PlatformId {
  return inferPlatformIdFromChannel(channel);
}

function getRequiredPlatform(id: string): PlatformDefinition {
  const platform = getPlatformDefinition(id);
  if (!platform) {
    throw new GatewayError("NOT_FOUND", "Platform not found", 404);
  }
  return platform;
}

function channelModeValue(value: unknown): ChannelMode {
  if (value === "use_existing" || value === "create_new" || value === "auto_create") {
    return value;
  }
  throw new GatewayError("VALIDATION_ERROR", "channelMode must be use_existing, create_new, or auto_create", 400);
}

function platformMatchesChannel(channel: ChannelRecord | ChannelTemplateDefinition, platformId: PlatformId): boolean {
  return inferPlatformIdFromChannel(channel) === platformId;
}

function validateChannelPlatform(channel: ChannelRecord, platformId: PlatformId): void {
  if (!platformMatchesChannel(channel, platformId)) {
    throw new GatewayError("VALIDATION_ERROR", "Channel does not belong to the selected platform", 400);
  }
}

function templateToChannelInput(template: ChannelTemplateDefinition): Record<string, unknown> {
  return {
    name: template.name,
    provider: template.provider,
    adapter_type: template.adapterType,
    protocol: template.protocol,
    base_url: template.baseUrl,
    status: template.status ?? "enabled",
    priority: 100,
    weight: 1,
    capabilities: template.capabilities ?? {},
    config: template.config ?? {}
  };
}

function channelInputFromBody(input: unknown, fallback?: ChannelTemplateDefinition): Record<string, unknown> {
  const body = input === undefined || input === null ? {} : bodyObject(input);
  const base = fallback ? templateToChannelInput(fallback) : {};
  const nextConfig =
    body.config !== undefined ? optionalJsonValue<Record<string, unknown> | null>(body, "config") ?? {} : base.config ?? {};
  return {
    ...base,
    name: body.name !== undefined ? stringValue(body, "name") : base.name,
    provider: body.provider !== undefined ? stringValue(body, "provider") : base.provider,
    adapter_type:
      body.adapterType !== undefined || body.adapter_type !== undefined
        ? stringValue(body, "adapterType", "adapter_type")
        : base.adapter_type,
    protocol: body.protocol !== undefined ? stringValue(body, "protocol") : base.protocol,
    base_url:
      body.baseUrl !== undefined || body.base_url !== undefined
        ? optionalString(body, "baseUrl", "base_url") ?? null
        : base.base_url ?? null,
    status: body.status !== undefined ? stringValue(body, "status") : base.status ?? "enabled",
    priority: body.priority !== undefined ? numberValue(body, "priority", "priority", 100) : base.priority ?? 100,
    weight: body.weight !== undefined ? numberValue(body, "weight", "weight", 1) : base.weight ?? 1,
    capabilities:
      body.capabilities !== undefined
        ? jsonValue(body, "capabilities", "capabilities", {}) ?? {}
        : base.capabilities ?? fallback?.capabilities ?? {},
    config: nextConfig
  };
}

function channelTemplateFromInput(input: Record<string, unknown>): ChannelTemplateDefinition {
  return {
    name: String(input.name ?? ""),
    provider: String(input.provider ?? ""),
    adapterType: String(input.adapter_type ?? input.adapterType ?? ""),
    protocol: String(input.protocol ?? ""),
    baseUrl: typeof input.base_url === "string" ? input.base_url : typeof input.baseUrl === "string" ? input.baseUrl : null,
    status: input.status === "disabled" ? "disabled" : "enabled",
    capabilities:
      input.capabilities && typeof input.capabilities === "object" && !Array.isArray(input.capabilities)
        ? (input.capabilities as Record<string, unknown>)
        : {},
    config: input.config && typeof input.config === "object" && !Array.isArray(input.config) ? (input.config as Record<string, unknown>) : {}
  };
}

function validateChannelInput(platform: PlatformDefinition, input: Record<string, unknown>): void {
  const channel = channelTemplateFromInput(input);
  if (!channel.name || !channel.provider || !channel.adapterType || !channel.protocol) {
    throw new GatewayError("VALIDATION_ERROR", "channel name, provider, adapter_type, and protocol are required", 400);
  }
  if (!platformMatchesChannel(channel, platform.id)) {
    throw new GatewayError("VALIDATION_ERROR", "channel adapter_type/provider does not match selected platform", 400);
  }
  if (platform.id === "openai_compatible" && !channel.baseUrl) {
    throw new GatewayError("VALIDATION_ERROR", "base_url is required for OpenAI-compatible channels", 400);
  }
}

async function createPlatformChannel(platform: PlatformDefinition, input: unknown): Promise<ChannelRecord> {
  const channelInput = channelInputFromBody(input, platform.defaultChannelTemplate);
  validateChannelInput(platform, channelInput);
  return createChannel(channelInput);
}

async function firstEnabledPlatformChannel(platform: PlatformDefinition): Promise<ChannelRecord | undefined> {
  const allChannels = await db.select().from(channels);
  const platformChannels = allChannels.filter(
    (channel) => channel.status === "enabled" && inferPlatformIdFromChannel(channel) === platform.id
  );
  return (
    platformChannels.find((channel) => channel.adapterType === platform.defaultAdapterType) ??
    platformChannels[0]
  );
}

async function resolveChannel(platform: PlatformDefinition, mode: ChannelMode, body: Record<string, unknown>): Promise<ChannelRecord> {
  if (mode === "use_existing") {
    const channelId = stringValue(body, "channelId", "channel_id");
    const channel = await getChannel(channelId);
    validateChannelPlatform(channel, platform.id);
    return channel;
  }

  if (mode === "create_new") {
    return createPlatformChannel(platform, body.channel);
  }

  const existing = await firstEnabledPlatformChannel(platform);
  if (existing) {
    return existing;
  }
  if (!platform.defaultChannelTemplate && body.channel === undefined) {
    throw new GatewayError("VALIDATION_ERROR", "No default channel template is available for this platform", 400);
  }
  return createPlatformChannel(platform, body.channel);
}

function validateLoginMethod(platform: PlatformDefinition, loginMethodId: string): void {
  const method = platform.supportedLoginMethods.find((item) => item.id === loginMethodId);
  if (!method) {
    throw new GatewayError("VALIDATION_ERROR", "loginMethodId is not supported by this platform", 400);
  }
  if (!method.implemented) {
    throw new GatewayError("VALIDATION_ERROR", "loginMethodId is not implemented yet", 400);
  }
}

function accountPayloadFromBody(accountInput: unknown, channelId: string): Record<string, unknown> {
  const body = bodyObject(accountInput);
  return {
    channel_id: channelId,
    name: stringValue(body, "name"),
    auth_type: stringValue(body, "authType", "auth_type", "bearer"),
    credential: stringValue(body, "credential"),
    proxy: optionalString(body, "proxy") ?? null,
    tags: jsonValue(body, "tags", "tags", []),
    weight: numberValue(body, "weight", "weight", 1),
    concurrency_limit: numberValue(body, "concurrencyLimit", "concurrency_limit", 5),
    status: stringValue(body, "status", "status", "enabled"),
    health_status: stringValue(body, "healthStatus", "health_status", "healthy"),
    quota_limit: optionalNumber(body, "quotaLimit", "quota_limit") ?? null,
    cooldown_until: optionalString(body, "cooldownUntil", "cooldown_until") ?? null
  };
}

async function readPlatformState(): Promise<{
  channels: ChannelRecord[];
  accounts: AccountRecord[];
  channelPlatformIds: Map<string, PlatformId>;
}> {
  const [allChannels, allAccounts] = await Promise.all([db.select().from(channels), db.select().from(accounts)]);
  const channelPlatformIds = new Map<string, PlatformId>();
  for (const channel of allChannels) {
    channelPlatformIds.set(channel.id, platformIdForChannel(channel));
  }
  return { channels: allChannels, accounts: allAccounts, channelPlatformIds };
}

function accountBelongsToPlatform(
  account: AccountRecord,
  platformId: PlatformId,
  channelPlatformIds: Map<string, PlatformId>
): boolean {
  return channelPlatformIds.get(account.channelId) === platformId;
}

function summarizePlatform(
  platform: PlatformDefinition,
  allChannels: ChannelRecord[],
  allAccounts: AccountRecord[],
  channelPlatformIds: Map<string, PlatformId>
): PlatformSummary {
  const platformChannels = allChannels.filter((channel) => channelPlatformIds.get(channel.id) === platform.id);
  const platformAccounts = allAccounts.filter((account) => accountBelongsToPlatform(account, platform.id, channelPlatformIds));
  const disabledAccounts = platformAccounts.filter(
    (account) => account.status === "disabled" || account.healthStatus === "disabled"
  ).length;
  const healthyAccounts = platformAccounts.filter(
    (account) => account.status === "enabled" && account.healthStatus === "healthy"
  ).length;
  const degradedAccounts = platformAccounts.filter(
    (account) => account.status !== "disabled" && account.healthStatus === "degraded"
  ).length;

  return {
    id: platform.id,
    name: platform.name,
    implementationStatus: platform.implementationStatus,
    accountsTotal: platformAccounts.length,
    healthyAccounts,
    degradedAccounts,
    disabledAccounts,
    channelsTotal: platformChannels.length,
    supportedLoginMethods: platform.supportedLoginMethods
  };
}

export async function listPlatforms() {
  return PLATFORM_DEFINITIONS;
}

export async function getPlatform(platformId: string) {
  return getRequiredPlatform(platformId);
}

export async function listPlatformSummaries() {
  const state = await readPlatformState();
  return PLATFORM_DEFINITIONS.map((platform) =>
    summarizePlatform(platform, state.channels, state.accounts, state.channelPlatformIds)
  );
}

export async function listPlatformAccounts(platformId: string) {
  const platform = getRequiredPlatform(platformId);
  const state = await readPlatformState();
  return state.accounts
    .filter((account) => accountBelongsToPlatform(account, platform.id, state.channelPlatformIds))
    .map(sanitizeAccount);
}

export async function listPlatformChannels(platformId: string) {
  const platform = getRequiredPlatform(platformId);
  const state = await readPlatformState();
  return state.channels.filter((channel) => state.channelPlatformIds.get(channel.id) === platform.id);
}

export async function createPlatformAccount(platformId: string, input: unknown) {
  const platform = getRequiredPlatform(platformId);
  const body = bodyObject(input);
  const loginMethodId = stringValue(body, "loginMethodId", "login_method_id");
  validateLoginMethod(platform, loginMethodId);
  const mode = channelModeValue(body.channelMode ?? body.channel_mode);
  const channel = await resolveChannel(platform, mode, body);
  const accountPayload = accountPayloadFromBody(body.account, channel.id);
  const account = await createAccount(accountPayload);
  return { channel: await getChannel(channel.id), account };
}
