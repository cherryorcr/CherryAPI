import { and, eq, inArray } from "drizzle-orm";
import { db } from "../database/client";
import {
  groupChannelPermissions,
  groupModelBindings,
  groupModelPermissions,
  models,
  type ChannelRecord,
  type GroupRecord,
  type ModelRecord
} from "../database/schema";
import { GatewayError } from "./errors";

export async function ensureModelAllowed(group: GroupRecord, model: ModelRecord): Promise<void> {
  const permission = await db
    .select()
    .from(groupModelPermissions)
    .where(
      and(
        eq(groupModelPermissions.groupId, group.id),
        eq(groupModelPermissions.modelId, model.id),
        eq(groupModelPermissions.enabled, true)
      )
    )
    .get();

  if (!permission) {
    throw new GatewayError("MODEL_NOT_ALLOWED", "Model is not allowed for this group", 403);
  }
}

export async function isChannelAllowed(group: GroupRecord, channel: ChannelRecord): Promise<boolean> {
  const permission = await db
    .select()
    .from(groupChannelPermissions)
    .where(
      and(
        eq(groupChannelPermissions.groupId, group.id),
        eq(groupChannelPermissions.channelId, channel.id),
        eq(groupChannelPermissions.enabled, true)
      )
    )
    .get();

  return Boolean(permission);
}

export async function listAllowedModels(group: GroupRecord): Promise<ModelRecord[]> {
  const permissions = await db
    .select()
    .from(groupModelPermissions)
    .where(and(eq(groupModelPermissions.groupId, group.id), eq(groupModelPermissions.enabled, true)));

  const modelIds = permissions.map((permission) => permission.modelId);
  if (modelIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(models)
    .where(and(inArray(models.id, modelIds), eq(models.status, "enabled")));
}

export async function listExposedPublicModelNames(group: GroupRecord): Promise<string[]> {
  const bindings = await db
    .select()
    .from(groupModelBindings)
    .where(and(eq(groupModelBindings.groupId, group.id), eq(groupModelBindings.enabled, true)));

  return [...new Set(bindings.map((binding) => binding.publicModel))].sort((left, right) =>
    left.localeCompare(right)
  );
}
