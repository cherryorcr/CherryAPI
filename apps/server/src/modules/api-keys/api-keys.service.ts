import { eq } from "drizzle-orm";
import { db } from "../../database/client";
import { apiKeys, type ApiKeyRecord, type NewApiKeyRecord } from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { generateApiKey } from "../../utils/crypto";
import { createId } from "../../utils/id";
import { bodyObject, nowIso, optionalNumber, optionalString, stringValue } from "../common/body";

function sanitizeApiKey(apiKey: ApiKeyRecord) {
  const { keyHash: _keyHash, ...safe } = apiKey;
  return safe;
}

export async function listApiKeys() {
  const rows = await db.select().from(apiKeys);
  return rows.map(sanitizeApiKey);
}

export async function getApiKey(id: string) {
  const apiKey = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  if (!apiKey) {
    throw new GatewayError("NOT_FOUND", "API key not found", 404);
  }
  return sanitizeApiKey(apiKey);
}

export async function createApiKey(input: unknown) {
  const body = bodyObject(input);
  const generated = generateApiKey();
  const record: NewApiKeyRecord = {
    id: createId("key"),
    name: stringValue(body, "name"),
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    groupId: stringValue(body, "groupId", "group_id"),
    status: stringValue(body, "status", "status", "enabled"),
    quotaLimit: optionalNumber(body, "quotaLimit", "quota_limit") ?? null,
    quotaUsed: 0,
    rpmLimit: optionalNumber(body, "rpmLimit", "rpm_limit") ?? null,
    tpmLimit: optionalNumber(body, "tpmLimit", "tpm_limit") ?? null,
    expiresAt: optionalString(body, "expiresAt", "expires_at") ?? null
  };
  await db.insert(apiKeys).values(record);
  return {
    ...sanitizeApiKey((await db.select().from(apiKeys).where(eq(apiKeys.id, record.id)).get())!),
    key: generated.key
  };
}

export async function updateApiKey(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewApiKeyRecord> = { updatedAt: nowIso() };
  if (body.name !== undefined) patch.name = stringValue(body, "name");
  if (body.groupId !== undefined || body.group_id !== undefined) patch.groupId = stringValue(body, "groupId", "group_id");
  if (body.status !== undefined) patch.status = stringValue(body, "status");
  if (body.quotaLimit !== undefined || body.quota_limit !== undefined) patch.quotaLimit = optionalNumber(body, "quotaLimit", "quota_limit") ?? null;
  if (body.rpmLimit !== undefined || body.rpm_limit !== undefined) patch.rpmLimit = optionalNumber(body, "rpmLimit", "rpm_limit") ?? null;
  if (body.tpmLimit !== undefined || body.tpm_limit !== undefined) patch.tpmLimit = optionalNumber(body, "tpmLimit", "tpm_limit") ?? null;
  if (body.expiresAt !== undefined || body.expires_at !== undefined) patch.expiresAt = optionalString(body, "expiresAt", "expires_at") ?? null;
  await db.update(apiKeys).set(patch).where(eq(apiKeys.id, id));
  return getApiKey(id);
}

export async function deleteApiKey(id: string) {
  await getApiKey(id);
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  return { ok: true };
}
