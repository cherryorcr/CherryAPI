import { eq } from "drizzle-orm";
import { db } from "../database/client";
import { accounts, apiKeys, channels, usageLogs, type NewUsageLogRecord } from "../database/schema";
import { createId } from "../utils/id";

export interface UsageEvent {
  requestId: string;
  apiKeyId?: string;
  apiKeyPrefix?: string;
  groupId?: string;
  modelId?: string;
  channelId?: string;
  channelName?: string;
  accountId?: string;
  accountName?: string;
  requestModel: string;
  upstreamModel?: string;
  status: "success" | "failed";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export async function writeUsageLog(event: UsageEvent): Promise<void> {
  const totalTokens = event.totalTokens ?? (event.promptTokens ?? 0) + (event.completionTokens ?? 0);
  const [channel, account] = await Promise.all([
    event.channelId && !event.channelName ? db.select().from(channels).where(eq(channels.id, event.channelId)).get() : undefined,
    event.accountId && (!event.accountName || event.status === "success")
      ? db.select().from(accounts).where(eq(accounts.id, event.accountId)).get()
      : undefined
  ]);
  const record: NewUsageLogRecord = {
    id: createId("ulg"),
    requestId: event.requestId,
    apiKeyId: event.apiKeyId ?? null,
    apiKeyPrefix: event.apiKeyPrefix ?? null,
    groupId: event.groupId ?? null,
    modelId: event.modelId ?? null,
    channelId: event.channelId ?? null,
    channelName: event.channelName ?? channel?.name ?? null,
    accountId: event.accountId ?? null,
    accountName: event.accountName ?? account?.name ?? null,
    requestModel: event.requestModel,
    upstreamModel: event.upstreamModel ?? null,
    status: event.status,
    promptTokens: event.promptTokens ?? 0,
    completionTokens: event.completionTokens ?? 0,
    totalTokens,
    cost: event.cost ?? 0,
    latencyMs: event.latencyMs,
    errorCode: event.errorCode ?? null,
    errorMessage: event.errorMessage?.slice(0, 1000) ?? null
  };

  await db.insert(usageLogs).values(record);

  if (event.status === "success") {
    if (event.apiKeyId) {
      const key = await db.select().from(apiKeys).where(eq(apiKeys.id, event.apiKeyId)).get();
      if (key) {
        await db
          .update(apiKeys)
          .set({ quotaUsed: key.quotaUsed + totalTokens, updatedAt: new Date().toISOString() })
          .where(eq(apiKeys.id, key.id));
      }
    }

    if (event.accountId) {
      if (account) {
        const now = new Date().toISOString();
        await db
          .update(accounts)
          .set({
            quotaUsed: account.quotaUsed + totalTokens,
            healthStatus: "healthy",
            lastSuccessAt: now,
            lastError: null,
            cooldownUntil: null,
            updatedAt: now
          })
          .where(eq(accounts.id, account.id));
      }
    }
  }
}
