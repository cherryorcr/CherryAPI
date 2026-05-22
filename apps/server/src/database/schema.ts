import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { AdapterCapabilities } from "@cherryapi/shared";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  adapterType: text("adapter_type").notNull(),
  protocol: text("protocol").notNull(),
  baseUrl: text("base_url"),
  status: text("status").notNull().default("enabled"),
  priority: integer("priority").notNull().default(100),
  weight: integer("weight").notNull().default(1),
  capabilities: text("capabilities", { mode: "json" })
    .$type<Partial<AdapterCapabilities> & Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  config: text("config", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  authType: text("auth_type").notNull(),
  credentialEncrypted: text("credential_encrypted").notNull(),
  proxy: text("proxy"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  weight: integer("weight").notNull().default(1),
  concurrencyLimit: integer("concurrency_limit").notNull().default(5),
  currentConcurrency: integer("current_concurrency").notNull().default(0),
  status: text("status").notNull().default("enabled"),
  healthStatus: text("health_status").notNull().default("healthy"),
  quotaLimit: integer("quota_limit"),
  quotaUsed: integer("quota_used").notNull().default(0),
  quotaSnapshot: text("quota_snapshot", { mode: "json" }).$type<Record<string, unknown> | null>(),
  quotaCheckedAt: text("quota_checked_at"),
  quotaLastError: text("quota_last_error"),
  quotaLastErrorAt: text("quota_last_error_at"),
  cooldownUntil: text("cooldown_until"),
  lastError: text("last_error"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  publicName: text("public_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  capabilities: text("capabilities", { mode: "json" })
    .$type<Partial<AdapterCapabilities> & Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  status: text("status").notNull().default("enabled"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const modelRoutes = sqliteTable("model_routes", {
  id: text("id").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id, { onDelete: "cascade" }),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  upstreamModelName: text("upstream_model_name").notNull(),
  priority: integer("priority").notNull().default(100),
  weight: integer("weight").notNull().default(1),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  fallbackOrder: integer("fallback_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const accountModelCapabilities = sqliteTable("account_model_capabilities", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  upstreamModelName: text("upstream_model_name").notNull(),
  displayName: text("display_name"),
  status: text("status").notNull().default("unknown"),
  capabilities: text("capabilities", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  latencyMs: integer("latency_ms"),
  source: text("source").notNull().default("manual"),
  verifiedByTest: integer("verified_by_test", { mode: "boolean" }).notNull().default(false),
  discoveryMode: text("discovery_mode").notNull().default("manual"),
  discoverySource: text("discovery_source"),
  warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  raw: text("raw", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const accountModelAliases = sqliteTable("account_model_aliases", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  publicModel: text("public_model").notNull(),
  upstreamModelName: text("upstream_model_name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  status: text("status").notNull().default("enabled"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const groupModelPermissions = sqliteTable("group_model_permissions", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  rpmLimit: integer("rpm_limit"),
  tpmLimit: integer("tpm_limit"),
  dailyQuota: integer("daily_quota"),
  priceMultiplier: integer("price_multiplier").notNull().default(100)
});

export const groupChannelPermissions = sqliteTable("group_channel_permissions", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
});

export const groupAccountRules = sqliteTable("group_account_rules", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  allowedTags: text("allowed_tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  blockedTags: text("blocked_tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  allowedAccountIds: text("allowed_account_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  blockedAccountIds: text("blocked_account_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`)
});

export const groupModelBindings = sqliteTable("group_model_bindings", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  publicModel: text("public_model").notNull(),
  upstreamModelName: text("upstream_model_name").notNull(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("detected"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(100),
  accountPriority: integer("account_priority").notNull().default(100),
  weight: integer("weight").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("enabled"),
  quotaLimit: integer("quota_limit"),
  quotaUsed: integer("quota_used").notNull().default(0),
  rpmLimit: integer("rpm_limit"),
  tpmLimit: integer("tpm_limit"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const usageLogs = sqliteTable("usage_logs", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  apiKeyId: text("api_key_id"),
  apiKeyPrefix: text("api_key_prefix"),
  groupId: text("group_id"),
  modelId: text("model_id"),
  channelId: text("channel_id"),
  channelName: text("channel_name"),
  accountId: text("account_id"),
  accountName: text("account_name"),
  requestModel: text("request_model").notNull(),
  upstreamModel: text("upstream_model"),
  status: text("status").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cost: integer("cost").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export type ChannelRecord = InferSelectModel<typeof channels>;
export type AccountRecord = InferSelectModel<typeof accounts>;
export type ModelRecord = InferSelectModel<typeof models>;
export type ModelRouteRecord = InferSelectModel<typeof modelRoutes>;
export type AccountModelCapabilityRecord = InferSelectModel<typeof accountModelCapabilities>;
export type AccountModelAliasRecord = InferSelectModel<typeof accountModelAliases>;
export type GroupRecord = InferSelectModel<typeof groups>;
export type GroupModelPermissionRecord = InferSelectModel<typeof groupModelPermissions>;
export type GroupChannelPermissionRecord = InferSelectModel<typeof groupChannelPermissions>;
export type GroupAccountRuleRecord = InferSelectModel<typeof groupAccountRules>;
export type GroupModelBindingRecord = InferSelectModel<typeof groupModelBindings>;
export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;
export type UsageLogRecord = InferSelectModel<typeof usageLogs>;
export type AppSettingRecord = InferSelectModel<typeof appSettings>;

export type NewChannelRecord = InferInsertModel<typeof channels>;
export type NewAccountRecord = InferInsertModel<typeof accounts>;
export type NewModelRecord = InferInsertModel<typeof models>;
export type NewModelRouteRecord = InferInsertModel<typeof modelRoutes>;
export type NewAccountModelCapabilityRecord = InferInsertModel<typeof accountModelCapabilities>;
export type NewAccountModelAliasRecord = InferInsertModel<typeof accountModelAliases>;
export type NewGroupRecord = InferInsertModel<typeof groups>;
export type NewGroupModelBindingRecord = InferInsertModel<typeof groupModelBindings>;
export type NewApiKeyRecord = InferInsertModel<typeof apiKeys>;
export type NewUsageLogRecord = InferInsertModel<typeof usageLogs>;
export type NewAppSettingRecord = InferInsertModel<typeof appSettings>;
