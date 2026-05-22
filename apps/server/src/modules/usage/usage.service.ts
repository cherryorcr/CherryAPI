import { desc } from "drizzle-orm";
import { db } from "../../database/client";
import { accounts, channels, usageLogs } from "../../database/schema";

function matchesFilter(value: string, ...candidates: Array<string | null | undefined>): boolean {
  return candidates.some((candidate) => candidate?.toLowerCase().includes(value));
}

export async function listUsageLogs(query: Record<string, unknown>) {
  const limit = Math.min(Number(query.limit ?? 100), 500);
  const [rows, channelRows, accountRows] = await Promise.all([
    db.select().from(usageLogs).orderBy(desc(usageLogs.createdAt)).limit(500),
    db.select().from(channels),
    db.select().from(accounts)
  ]);
  const channelById = new Map(channelRows.map((channel) => [channel.id, channel]));
  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const enrichedRows = rows.map((row) => {
    const channel = row.channelId ? channelById.get(row.channelId) : undefined;
    const account = row.accountId ? accountById.get(row.accountId) : undefined;
    return {
      ...row,
      channelName: row.channelName ?? channel?.name ?? null,
      accountName: row.accountName ?? account?.name ?? null
    };
  });
  const status = typeof query.status === "string" ? query.status.trim() : "";
  const model = typeof query.model === "string" ? query.model.trim().toLowerCase() : "";
  const channel = typeof query.channel === "string" ? query.channel.trim().toLowerCase() : "";
  const account = typeof query.account === "string" ? query.account.trim().toLowerCase() : "";
  const keyword = typeof query.keyword === "string" ? query.keyword.trim().toLowerCase() : "";

  return enrichedRows
    .filter((row) => !status || row.status === status)
    .filter((row) => !model || row.requestModel.toLowerCase().includes(model) || row.upstreamModel?.toLowerCase().includes(model))
    .filter((row) => !channel || matchesFilter(channel, row.channelId, row.channelName))
    .filter((row) => !account || matchesFilter(account, row.accountId, row.accountName))
    .filter((row) => !keyword || row.errorMessage?.toLowerCase().includes(keyword))
    .slice(0, limit);
}
