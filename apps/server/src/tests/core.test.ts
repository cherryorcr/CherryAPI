import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { FastifyRequest } from "fastify";

const testDbFile = path.resolve(process.cwd(), "data/cherryapi-test.sqlite");
fs.rmSync(testDbFile, { force: true });

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${testDbFile}`;
process.env.ADMIN_TOKEN = "test-admin-token";
process.env.ENCRYPTION_KEY = "test-encryption-key-with-enough-length";
process.env.LOG_LEVEL = "silent";

let eq: typeof import("drizzle-orm").eq;
let initializeDatabase: typeof import("../database/init").initializeDatabase;
let db: typeof import("../database/client").db;
let schema: typeof import("../database/schema");
let authenticateApiKey: typeof import("../core/auth").authenticateApiKey;
let requireAdmin: typeof import("../core/auth").requireAdmin;
let quotaExceeded: typeof import("../core/quota").quotaExceeded;
let RouteResolver: typeof import("../core/route-resolver").RouteResolver;
let GatewayError: typeof import("../core/errors").GatewayError;
let createApiKey: typeof import("../modules/api-keys/api-keys.service").createApiKey;
let buildOpenAICompatibleUpstreamBody: typeof import("../adapters/openai-compatible.adapter").buildOpenAICompatibleUpstreamBody;
let chatCompletionsUrl: typeof import("../adapters/openai-compatible.adapter").chatCompletionsUrl;
let openAIModelsUrl: typeof import("../adapters/openai-compatible.adapter").openAIModelsUrl;
let encryptSecret: typeof import("../utils/crypto").encryptSecret;

function requestWithBearer(token?: string): FastifyRequest {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  } as FastifyRequest;
}

before(async () => {
  ({ eq } = await import("drizzle-orm"));
  ({ initializeDatabase } = await import("../database/init"));
  ({ db } = await import("../database/client"));
  schema = await import("../database/schema");
  ({ authenticateApiKey, requireAdmin } = await import("../core/auth"));
  ({ quotaExceeded } = await import("../core/quota"));
  ({ RouteResolver } = await import("../core/route-resolver"));
  ({ GatewayError } = await import("../core/errors"));
  ({ createApiKey } = await import("../modules/api-keys/api-keys.service"));
  ({ buildOpenAICompatibleUpstreamBody, chatCompletionsUrl, openAIModelsUrl } = await import("../adapters/openai-compatible.adapter"));
  ({ encryptSecret } = await import("../utils/crypto"));
  await initializeDatabase();
});

test("admin auth accepts only the configured bearer token", () => {
  assert.doesNotThrow(() => requireAdmin(requestWithBearer("test-admin-token")));
  assert.throws(() => requireAdmin(requestWithBearer("wrong-token")), GatewayError);
  assert.throws(() => requireAdmin(requestWithBearer()), GatewayError);
});

test("quotaExceeded respects null limits and exhausted quotas", () => {
  assert.equal(quotaExceeded(100, null), false);
  assert.equal(quotaExceeded(99, 100), false);
  assert.equal(quotaExceeded(100, 100), true);
  assert.equal(quotaExceeded(101, 100), true);
});

test("OpenAI-compatible adapter builds stable upstream URLs and bodies", () => {
  assert.equal(chatCompletionsUrl("https://api.example.com/v1"), "https://api.example.com/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.equal(openAIModelsUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/models");

  const body = buildOpenAICompatibleUpstreamBody(
    {
      model: "public-model",
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      temperature: Number.NaN,
      metadata: { keep: true, omit: undefined }
    },
    "upstream-model",
    true
  );

  assert.equal(body.model, "upstream-model");
  assert.equal(body.stream, true);
  assert.deepEqual(body.metadata, { keep: true });
  assert.equal(body.temperature, null);
});

test("API key authentication enforces status, group, and quota permissions", async () => {
  await db.insert(schema.groups).values({
    id: "test_auth_group",
    name: "test-auth-group",
    status: "enabled"
  });

  const created = await createApiKey({
    name: "test-key",
    group_id: "test_auth_group",
    status: "enabled",
    quota_limit: 2
  });

  const context = await authenticateApiKey(requestWithBearer(created.key));
  assert.equal(context.apiKey.id, created.id);
  assert.equal(context.group.id, "test_auth_group");

  await db.update(schema.apiKeys).set({ status: "disabled" }).where(eq(schema.apiKeys.id, created.id));
  await assert.rejects(() => authenticateApiKey(requestWithBearer(created.key)), /Invalid API key/);

  const quotaKey = await createApiKey({
    name: "quota-key",
    group_id: "test_auth_group",
    status: "enabled",
    quota_limit: 0
  });
  await assert.rejects(() => authenticateApiKey(requestWithBearer(quotaKey.key)), /quota has been exhausted/);

  await db.update(schema.apiKeys).set({ status: "enabled", quotaLimit: null }).where(eq(schema.apiKeys.id, created.id));
  await db.update(schema.groups).set({ status: "disabled" }).where(eq(schema.groups.id, "test_auth_group"));
  await assert.rejects(() => authenticateApiKey(requestWithBearer(created.key)), /group is disabled/);
});

test("route resolver returns a group model binding with an allowed account", async () => {
  const now = new Date().toISOString();
  await db.insert(schema.groups).values({
    id: "test_route_group",
    name: "test-route-group",
    status: "enabled"
  });
  await db.insert(schema.channels).values({
    id: "test_route_channel",
    name: "Test Route Channel",
    provider: "test",
    adapterType: "openai_compatible",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.example.com/v1",
    status: "enabled",
    capabilities: { chatCompletions: true, streaming: true, tools: true }
  });
  await db.insert(schema.accounts).values({
    id: "test_route_account",
    channelId: "test_route_channel",
    name: "test-route-account",
    authType: "api_key",
    credentialEncrypted: encryptSecret("upstream-secret"),
    tags: ["normal"],
    weight: 1,
    concurrencyLimit: 5,
    currentConcurrency: 0,
    status: "enabled",
    healthStatus: "healthy",
    quotaUsed: 0
  });
  await db.insert(schema.groupChannelPermissions).values({
    id: "test_route_channel_permission",
    groupId: "test_route_group",
    channelId: "test_route_channel",
    enabled: true
  });
  await db.insert(schema.accountModelCapabilities).values({
    id: "test_route_capability",
    accountId: "test_route_account",
    channelId: "test_route_channel",
    upstreamModelName: "upstream-chat",
    displayName: "upstream-chat",
    status: "available",
    capabilities: { chatCompletions: true, streaming: true },
    source: "test",
    verifiedByTest: true,
    discoveryMode: "manual",
    warnings: [],
    raw: {}
  });
  await db.insert(schema.groupModelBindings).values({
    id: "test_route_binding",
    groupId: "test_route_group",
    publicModel: "public-chat",
    upstreamModelName: "upstream-chat",
    channelId: "test_route_channel",
    accountId: "test_route_account",
    source: "detected",
    enabled: true,
    priority: 100,
    accountPriority: 100,
    weight: 1,
    createdAt: now,
    updatedAt: now
  });

  const apiKey = await createApiKey({
    name: "route-key",
    group_id: "test_route_group",
    status: "enabled"
  });
  const group = (await db.select().from(schema.groups).where(eq(schema.groups.id, "test_route_group")).get())!;
  const storedApiKey = (await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, apiKey.id)).get())!;

  const resolved = await new RouteResolver().resolve(storedApiKey, group, {
    model: "public-chat",
    messages: [{ role: "user", content: "ping" }]
  });

  assert.equal(resolved.channel.id, "test_route_channel");
  assert.equal(resolved.account.id, "test_route_account");
  assert.equal(resolved.upstreamModelName, "upstream-chat");
  assert.equal(resolved.binding?.id, "test_route_binding");
});
