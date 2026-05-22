import { eq } from "drizzle-orm";
import { db } from "../../database/client";
import { channels, type NewChannelRecord } from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { createId } from "../../utils/id";
import {
  bodyObject,
  jsonValue,
  nowIso,
  numberValue,
  optionalJsonValue,
  optionalNumber,
  optionalString,
  stringValue
} from "../common/body";

export async function listChannels() {
  return db.select().from(channels);
}

export async function getChannel(id: string) {
  const channel = await db.select().from(channels).where(eq(channels.id, id)).get();
  if (!channel) {
    throw new GatewayError("NOT_FOUND", "Channel not found", 404);
  }
  return channel;
}

export async function createChannel(input: unknown) {
  const body = bodyObject(input);
  const record: NewChannelRecord = {
    id: createId("ch"),
    name: stringValue(body, "name"),
    provider: stringValue(body, "provider"),
    adapterType: stringValue(body, "adapterType", "adapter_type"),
    protocol: stringValue(body, "protocol"),
    baseUrl: optionalString(body, "baseUrl", "base_url") ?? null,
    status: stringValue(body, "status", "status", "enabled"),
    priority: numberValue(body, "priority", "priority", 100),
    weight: numberValue(body, "weight", "weight", 1),
    capabilities: jsonValue(body, "capabilities", "capabilities", {}),
    config: jsonValue(body, "config", "config", {})
  };
  await db.insert(channels).values(record);
  return getChannel(record.id);
}

export async function updateChannel(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewChannelRecord> = { updatedAt: nowIso() };
  if (body.name !== undefined) patch.name = stringValue(body, "name");
  if (body.provider !== undefined) patch.provider = stringValue(body, "provider");
  if (body.adapterType !== undefined || body.adapter_type !== undefined) patch.adapterType = stringValue(body, "adapterType", "adapter_type");
  if (body.protocol !== undefined) patch.protocol = stringValue(body, "protocol");
  if (body.baseUrl !== undefined || body.base_url !== undefined) patch.baseUrl = optionalString(body, "baseUrl", "base_url") ?? null;
  if (body.status !== undefined) patch.status = stringValue(body, "status");
  if (body.priority !== undefined) patch.priority = optionalNumber(body, "priority") ?? 100;
  if (body.weight !== undefined) patch.weight = optionalNumber(body, "weight") ?? 1;
  if (body.capabilities !== undefined) patch.capabilities = optionalJsonValue(body, "capabilities");
  if (body.config !== undefined) patch.config = optionalJsonValue(body, "config");
  await db.update(channels).set(patch).where(eq(channels.id, id));
  return getChannel(id);
}

export async function deleteChannel(id: string) {
  await getChannel(id);
  await db.delete(channels).where(eq(channels.id, id));
  return { ok: true };
}
