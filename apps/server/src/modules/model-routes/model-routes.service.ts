import { eq } from "drizzle-orm";
import { db } from "../../database/client";
import { modelRoutes, type NewModelRouteRecord } from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { createId } from "../../utils/id";
import {
  bodyObject,
  booleanValue,
  nowIso,
  numberValue,
  optionalNumber,
  stringValue
} from "../common/body";

export async function listModelRoutes() {
  return db.select().from(modelRoutes);
}

export async function getModelRoute(id: string) {
  const route = await db.select().from(modelRoutes).where(eq(modelRoutes.id, id)).get();
  if (!route) {
    throw new GatewayError("NOT_FOUND", "Model route not found", 404);
  }
  return route;
}

export async function createModelRoute(input: unknown) {
  const body = bodyObject(input);
  const record: NewModelRouteRecord = {
    id: createId("mrt"),
    modelId: stringValue(body, "modelId", "model_id"),
    channelId: stringValue(body, "channelId", "channel_id"),
    upstreamModelName: stringValue(body, "upstreamModelName", "upstream_model_name"),
    priority: numberValue(body, "priority", "priority", 100),
    weight: numberValue(body, "weight", "weight", 1),
    enabled: booleanValue(body, "enabled", "enabled", true),
    fallbackOrder: numberValue(body, "fallbackOrder", "fallback_order", 0)
  };
  await db.insert(modelRoutes).values(record);
  return getModelRoute(record.id);
}

export async function updateModelRoute(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewModelRouteRecord> = { updatedAt: nowIso() };
  if (body.modelId !== undefined || body.model_id !== undefined) patch.modelId = stringValue(body, "modelId", "model_id");
  if (body.channelId !== undefined || body.channel_id !== undefined) patch.channelId = stringValue(body, "channelId", "channel_id");
  if (body.upstreamModelName !== undefined || body.upstream_model_name !== undefined) patch.upstreamModelName = stringValue(body, "upstreamModelName", "upstream_model_name");
  if (body.priority !== undefined) patch.priority = optionalNumber(body, "priority") ?? 100;
  if (body.weight !== undefined) patch.weight = optionalNumber(body, "weight") ?? 1;
  if (body.enabled !== undefined) patch.enabled = booleanValue(body, "enabled");
  if (body.fallbackOrder !== undefined || body.fallback_order !== undefined) patch.fallbackOrder = optionalNumber(body, "fallbackOrder", "fallback_order") ?? 0;
  await db.update(modelRoutes).set(patch).where(eq(modelRoutes.id, id));
  return getModelRoute(id);
}

export async function deleteModelRoute(id: string) {
  await getModelRoute(id);
  await db.delete(modelRoutes).where(eq(modelRoutes.id, id));
  return { ok: true };
}
