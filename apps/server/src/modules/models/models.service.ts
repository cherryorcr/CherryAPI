import { eq } from "drizzle-orm";
import { db } from "../../database/client";
import { models, type NewModelRecord } from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { createId } from "../../utils/id";
import {
  bodyObject,
  jsonValue,
  nowIso,
  optionalJsonValue,
  optionalString,
  stringValue
} from "../common/body";

export async function listModels() {
  return db.select().from(models);
}

export async function getModel(id: string) {
  const model = await db.select().from(models).where(eq(models.id, id)).get();
  if (!model) {
    throw new GatewayError("NOT_FOUND", "Model not found", 404);
  }
  return model;
}

export async function createModel(input: unknown) {
  const body = bodyObject(input);
  const record: NewModelRecord = {
    id: createId("mdl"),
    publicName: stringValue(body, "publicName", "public_name"),
    displayName: stringValue(body, "displayName", "display_name"),
    description: optionalString(body, "description") ?? null,
    capabilities: jsonValue(body, "capabilities", "capabilities", {}),
    status: stringValue(body, "status", "status", "enabled")
  };
  await db.insert(models).values(record);
  return getModel(record.id);
}

export async function updateModel(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewModelRecord> = { updatedAt: nowIso() };
  if (body.publicName !== undefined || body.public_name !== undefined) patch.publicName = stringValue(body, "publicName", "public_name");
  if (body.displayName !== undefined || body.display_name !== undefined) patch.displayName = stringValue(body, "displayName", "display_name");
  if (body.description !== undefined) patch.description = optionalString(body, "description") ?? null;
  if (body.capabilities !== undefined) patch.capabilities = optionalJsonValue(body, "capabilities");
  if (body.status !== undefined) patch.status = stringValue(body, "status");
  await db.update(models).set(patch).where(eq(models.id, id));
  return getModel(id);
}

export async function deleteModel(id: string) {
  await getModel(id);
  await db.delete(models).where(eq(models.id, id));
  return { ok: true };
}
