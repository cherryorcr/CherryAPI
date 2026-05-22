import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../database/client";
import { apiKeys, groups, type ApiKeyRecord, type GroupRecord } from "../database/schema";
import { GatewayError } from "./errors";
import { env } from "../utils/env";
import { hashApiKey } from "../utils/crypto";

export interface AuthContext {
  apiKey: ApiKeyRecord;
  group: GroupRecord;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

export function requireAdmin(request: FastifyRequest): void {
  const token = bearerToken(request);
  if (!token || token !== env.ADMIN_TOKEN) {
    throw new GatewayError("UNAUTHORIZED", "Invalid admin token", 401);
  }
}

export async function authenticateApiKey(request: FastifyRequest): Promise<AuthContext> {
  const token = bearerToken(request);
  if (!token) {
    throw new GatewayError("UNAUTHORIZED", "Missing API key", 401);
  }

  const keyHash = hashApiKey(token);
  const apiKey = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();
  if (!apiKey || apiKey.status !== "enabled") {
    throw new GatewayError("UNAUTHORIZED", "Invalid API key", 401);
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()) {
    throw new GatewayError("UNAUTHORIZED", "API key has expired", 401);
  }

  if (apiKey.quotaLimit !== null && apiKey.quotaUsed >= apiKey.quotaLimit) {
    throw new GatewayError("FORBIDDEN", "API key quota has been exhausted", 403);
  }

  const group = await db.select().from(groups).where(eq(groups.id, apiKey.groupId)).get();
  if (!group || group.status !== "enabled") {
    throw new GatewayError("FORBIDDEN", "API key group is disabled", 403);
  }

  return { apiKey, group };
}
