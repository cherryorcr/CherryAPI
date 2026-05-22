import { and, eq } from "drizzle-orm";
import { db } from "../database/client";
import {
  accounts,
  groupAccountRules,
  type AccountRecord,
  type ChannelRecord,
  type GroupRecord
} from "../database/schema";
import { accountMatchesRule } from "./group-account-scope";

function weightedPick(candidates: AccountRecord[]): AccountRecord | undefined {
  const total = candidates.reduce((sum, account) => sum + Math.max(1, account.weight), 0);
  let cursor = Math.random() * total;
  for (const account of candidates) {
    cursor -= Math.max(1, account.weight);
    if (cursor <= 0) {
      return account;
    }
  }
  return candidates[0];
}

export class AccountScheduler {
  async checkout(channel: ChannelRecord, group: GroupRecord): Promise<AccountRecord | undefined> {
    const rule = await db
      .select()
      .from(groupAccountRules)
      .where(and(eq(groupAccountRules.groupId, group.id), eq(groupAccountRules.channelId, channel.id)))
      .get();

    const channelAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.channelId, channel.id));

    const usable = channelAccounts.filter((account) => accountMatchesRule(account, rule));
    const healthy = usable.filter((account) => account.healthStatus === "healthy");
    const degraded = usable.filter((account) => account.healthStatus === "degraded");
    const selected = weightedPick(healthy.length ? healthy : degraded);

    if (!selected) {
      return undefined;
    }

    await db
      .update(accounts)
      .set({
        currentConcurrency: selected.currentConcurrency + 1,
        updatedAt: new Date().toISOString()
      })
      .where(eq(accounts.id, selected.id));

    return {
      ...selected,
      currentConcurrency: selected.currentConcurrency + 1
    };
  }

  async checkoutAccount(accountId: string, channel: ChannelRecord, group: GroupRecord): Promise<AccountRecord | undefined> {
    const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account || account.channelId !== channel.id) {
      return undefined;
    }

    const rule = await db
      .select()
      .from(groupAccountRules)
      .where(and(eq(groupAccountRules.groupId, group.id), eq(groupAccountRules.channelId, channel.id)))
      .get();

    if (!accountMatchesRule(account, rule)) {
      return undefined;
    }

    await db
      .update(accounts)
      .set({
        currentConcurrency: account.currentConcurrency + 1,
        updatedAt: new Date().toISOString()
      })
      .where(eq(accounts.id, account.id));

    return {
      ...account,
      currentConcurrency: account.currentConcurrency + 1
    };
  }

  async release(accountId: string): Promise<void> {
    const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) {
      return;
    }

    await db
      .update(accounts)
      .set({
        currentConcurrency: Math.max(0, account.currentConcurrency - 1),
        updatedAt: new Date().toISOString()
      })
      .where(eq(accounts.id, accountId));
  }

  async recordSuccess(accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .update(accounts)
      .set({
        healthStatus: "healthy",
        lastSuccessAt: now,
        lastError: null,
        cooldownUntil: null,
        updatedAt: now
      })
      .where(eq(accounts.id, accountId));
  }

  async recordFailure(accountId: string, errorMessage: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .update(accounts)
      .set({
        healthStatus: "degraded",
        lastFailureAt: now,
        lastError: errorMessage.slice(0, 1000),
        cooldownUntil: new Date(Date.now() + 30_000).toISOString(),
        updatedAt: now
      })
      .where(eq(accounts.id, accountId));
  }
}

export const accountScheduler = new AccountScheduler();
