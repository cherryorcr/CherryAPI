import { and, eq } from "drizzle-orm";
import { client, db } from "./client";
import {
  channels,
  groupChannelPermissions,
  groupModelPermissions,
  groups,
  models
} from "./schema";

function sqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function createSchema(): Promise<void> {
  const statements = sqlStatements(`
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT,
  status TEXT NOT NULL DEFAULT 'enabled',
  priority INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL DEFAULT '{}',
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  credential_encrypted TEXT NOT NULL,
  proxy TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  weight INTEGER NOT NULL DEFAULT 1,
  concurrency_limit INTEGER NOT NULL DEFAULT 5,
  current_concurrency INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  health_status TEXT NOT NULL DEFAULT 'healthy',
  quota_limit INTEGER,
  quota_used INTEGER NOT NULL DEFAULT 0,
  quota_snapshot TEXT,
  quota_checked_at TEXT,
  quota_last_error TEXT,
  quota_last_error_at TEXT,
  cooldown_until TEXT,
  last_error TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  public_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  capabilities TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_routes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  upstream_model_name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  fallback_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_model_capabilities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  upstream_model_name TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  latency_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  verified_by_test INTEGER NOT NULL DEFAULT 0,
  discovery_mode TEXT NOT NULL DEFAULT 'manual',
  discovery_source TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  raw TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, upstream_model_name)
);

CREATE TABLE IF NOT EXISTS account_model_aliases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_model TEXT NOT NULL,
  upstream_model_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, public_model)
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_model_permissions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  rpm_limit INTEGER,
  tpm_limit INTEGER,
  daily_quota INTEGER,
  price_multiplier INTEGER NOT NULL DEFAULT 100,
  UNIQUE(group_id, model_id)
);

CREATE TABLE IF NOT EXISTS group_channel_permissions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(group_id, channel_id)
);

CREATE TABLE IF NOT EXISTS group_account_rules (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  allowed_tags TEXT NOT NULL DEFAULT '[]',
  blocked_tags TEXT NOT NULL DEFAULT '[]',
  allowed_account_ids TEXT NOT NULL DEFAULT '[]',
  blocked_account_ids TEXT NOT NULL DEFAULT '[]',
  UNIQUE(group_id, channel_id)
);

CREATE TABLE IF NOT EXISTS group_model_bindings (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  public_model TEXT NOT NULL,
  upstream_model_name TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'detected',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  account_priority INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, public_model, account_id, upstream_model_name, source)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'enabled',
  quota_limit INTEGER,
  quota_used INTEGER NOT NULL DEFAULT 0,
  rpm_limit INTEGER,
  tpm_limit INTEGER,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  api_key_id TEXT,
  api_key_prefix TEXT,
  group_id TEXT,
  model_id TEXT,
  channel_id TEXT,
  channel_name TEXT,
  account_id TEXT,
  account_name TEXT,
  request_model TEXT NOT NULL,
  upstream_model TEXT,
  status TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_channel ON accounts(channel_id);
CREATE INDEX IF NOT EXISTS idx_model_routes_model ON model_routes(model_id);
CREATE INDEX IF NOT EXISTS idx_account_model_capabilities_account ON account_model_capabilities(account_id);
CREATE INDEX IF NOT EXISTS idx_account_model_capabilities_channel ON account_model_capabilities(channel_id);
CREATE INDEX IF NOT EXISTS idx_account_model_capabilities_status ON account_model_capabilities(status);
CREATE INDEX IF NOT EXISTS idx_account_model_aliases_account ON account_model_aliases(account_id);
CREATE INDEX IF NOT EXISTS idx_account_model_aliases_public ON account_model_aliases(public_model);
CREATE INDEX IF NOT EXISTS idx_group_model_bindings_group_model ON group_model_bindings(group_id, public_model);
CREATE INDEX IF NOT EXISTS idx_group_model_bindings_account ON group_model_bindings(account_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
`);

  for (const statement of statements) {
    await client.execute(statement);
  }

  await ensureColumn("accounts", "last_success_at", "TEXT");
  await ensureColumn("accounts", "last_failure_at", "TEXT");
  await ensureColumn("accounts", "quota_snapshot", "TEXT");
  await ensureColumn("accounts", "quota_checked_at", "TEXT");
  await ensureColumn("accounts", "quota_last_error", "TEXT");
  await ensureColumn("accounts", "quota_last_error_at", "TEXT");
  await ensureColumn("account_model_capabilities", "verified_by_test", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("account_model_capabilities", "discovery_mode", "TEXT NOT NULL DEFAULT 'manual'");
  await ensureColumn("account_model_capabilities", "discovery_source", "TEXT");
  await ensureColumn("account_model_capabilities", "warnings", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn("account_model_capabilities", "raw", "TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn("group_account_rules", "blocked_tags", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn("group_model_bindings", "account_priority", "INTEGER NOT NULL DEFAULT 100");
  await ensureColumn("usage_logs", "channel_name", "TEXT");
  await ensureColumn("usage_logs", "account_name", "TEXT");
}

async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  const columns = result.rows.map((row) => String(row.name));
  if (!columns.includes(column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const defaultChannels = [
  {
    id: "ch_openai_compatible",
    name: "OpenAI Compatible",
    provider: "openai_compatible",
    adapterType: "openai_compatible",
    protocol: "openai_chat_completions",
    baseUrl: null,
    capabilities: { chatCompletions: true, streaming: true, tools: true, responses: false }
  },
  {
    id: "ch_openai_api",
    name: "OpenAI API",
    provider: "openai",
    adapterType: "openai_api",
    protocol: "openai_chat_or_responses",
    baseUrl: "https://api.openai.com/v1",
    capabilities: { chatCompletions: true, streaming: true, tools: true, responses: true }
  },
  {
    id: "ch_claude_oauth",
    name: "Claude OAuth",
    provider: "anthropic",
    adapterType: "claude_oauth",
    protocol: "anthropic_messages",
    baseUrl: null,
    capabilities: { chatCompletions: true, streaming: true, tools: false, responses: false }
  },
  {
    id: "ch_claude_api",
    name: "Claude API",
    provider: "anthropic",
    adapterType: "claude_api",
    protocol: "anthropic_messages",
    baseUrl: "https://api.anthropic.com/v1",
    capabilities: { chatCompletions: true, streaming: true, tools: false, responses: false }
  },
  {
    id: "ch_chatgpt_oauth",
    name: "ChatGPT OAuth",
    provider: "openai",
    adapterType: "chatgpt_oauth",
    protocol: "openai_internal",
    baseUrl: null,
    capabilities: { chatCompletions: true, streaming: true, tools: true, responses: true }
  },
  {
    id: "ch_codex",
    name: "Codex",
    provider: "openai",
    adapterType: "codex",
    protocol: "codex_responses_stream",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    capabilities: { chatCompletions: true, streaming: true, tools: false, responses: true },
    config: {}
  },
  {
    id: "ch_gemini",
    name: "Gemini",
    provider: "google",
    adapterType: "gemini",
    protocol: "gemini_api",
    baseUrl: null,
    capabilities: { chatCompletions: true, streaming: true, tools: true, responses: false }
  },
  {
    id: "ch_antigravity",
    name: "Antigravity",
    provider: "antigravity",
    adapterType: "antigravity",
    protocol: "antigravity_internal",
    baseUrl: null,
    capabilities: { chatCompletions: true, streaming: true, tools: true, responses: false }
  }
];

const defaultModels = [
  { id: "mdl_openai_compatible_chat", publicName: "openai-compatible-chat", displayName: "OpenAI Compatible Chat" },
  { id: "mdl_deepseek_chat", publicName: "deepseek-chat", displayName: "DeepSeek Chat" },
  { id: "mdl_claude_sonnet", publicName: "claude-sonnet", displayName: "Claude Sonnet" },
  { id: "mdl_gpt_55", publicName: "gpt-5.5", displayName: "GPT 5.5" },
  { id: "mdl_codex_coding", publicName: "codex-coding", displayName: "Codex Coding" },
  { id: "mdl_gemini_pro", publicName: "gemini-pro", displayName: "Gemini Pro" },
  { id: "mdl_antigravity_coding", publicName: "antigravity-coding", displayName: "Antigravity Coding" }
];

const defaultGroups = [
  { id: "grp_default", name: "default", description: "Default public access group" },
  { id: "grp_pro", name: "pro", description: "Pro access group" },
  { id: "grp_internal", name: "internal", description: "Internal full-access group" }
];

function stripCandidateModels(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const next = { ...(config ?? {}) };
  delete next.candidateModels;
  delete next.candidate_models;
  return next;
}

export async function seedDefaults(): Promise<void> {
  await db.insert(channels).values(defaultChannels).onConflictDoNothing();
  const codexChannel = await db.select().from(channels).where(eq(channels.id, "ch_codex")).get();
  if (
    codexChannel &&
    (codexChannel.capabilities?.chatCompletions !== true ||
      codexChannel.config?.candidateModels !== undefined ||
      codexChannel.config?.candidate_models !== undefined)
  ) {
    await db
      .update(channels)
      .set({
        baseUrl: codexChannel.baseUrl ?? "https://chatgpt.com/backend-api/codex",
        capabilities: {
          ...codexChannel.capabilities,
          chatCompletions: true,
          streaming: true,
          tools: false,
          responses: true
        },
        config: stripCandidateModels(codexChannel.config),
        updatedAt: new Date().toISOString()
      })
      .where(eq(channels.id, "ch_codex"));
  }
  await db
    .insert(models)
    .values(
      defaultModels.map((model) => ({
        ...model,
        capabilities: { chatCompletions: true, streaming: true, tools: true, responses: false }
      }))
    )
    .onConflictDoNothing();
  await db.insert(groups).values(defaultGroups).onConflictDoNothing();

  const allModels = await db.select().from(models);
  const allChannels = await db.select().from(channels);

  for (const model of allModels) {
    await db
      .insert(groupModelPermissions)
      .values({
        id: `gmp_internal_${model.id}`,
        groupId: "grp_internal",
        modelId: model.id,
        enabled: true
      })
      .onConflictDoNothing();
  }

  for (const channel of allChannels) {
    await db
      .insert(groupChannelPermissions)
      .values({
        id: `gcp_internal_${channel.id}`,
        groupId: "grp_internal",
        channelId: channel.id,
        enabled: true
      })
      .onConflictDoNothing();
  }

  const openAICompatibleModel = await db
    .select()
    .from(models)
    .where(eq(models.publicName, "openai-compatible-chat"))
    .get();

  if (openAICompatibleModel) {
    await db
      .insert(groupModelPermissions)
      .values({
        id: `gmp_default_${openAICompatibleModel.id}`,
        groupId: "grp_default",
        modelId: openAICompatibleModel.id,
        enabled: true
      })
      .onConflictDoNothing();
  }

  const openAICompatibleChannel = await db
    .select()
    .from(channels)
    .where(eq(channels.id, "ch_openai_compatible"))
    .get();

  if (openAICompatibleChannel) {
    await db
      .insert(groupChannelPermissions)
      .values({
        id: `gcp_default_${openAICompatibleChannel.id}`,
        groupId: "grp_default",
        channelId: openAICompatibleChannel.id,
        enabled: true
      })
      .onConflictDoNothing();
  }

  const existingProModelPermissions = await db
    .select()
    .from(groupModelPermissions)
    .where(and(eq(groupModelPermissions.groupId, "grp_pro"), eq(groupModelPermissions.enabled, true)));

  if (existingProModelPermissions.length === 0) {
    for (const model of allModels) {
      await db
        .insert(groupModelPermissions)
        .values({
          id: `gmp_pro_${model.id}`,
          groupId: "grp_pro",
          modelId: model.id,
          enabled: true
        })
        .onConflictDoNothing();
    }
  }
}

export async function initializeDatabase(): Promise<void> {
  await createSchema();
  await seedDefaults();
}
