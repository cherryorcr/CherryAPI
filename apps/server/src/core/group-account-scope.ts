import { and, eq } from "drizzle-orm";
import { db } from "../database/client";
import {
  groupAccountRules,
  groupChannelPermissions,
  type AccountRecord,
  type GroupAccountRuleRecord,
  type GroupRecord
} from "../database/schema";

export interface GroupAccountScope {
  allowedChannelIds: Set<string>;
  ruleByChannelId: Map<string, GroupAccountRuleRecord>;
}

export interface AccountMatchOptions {
  checkConcurrency?: boolean;
  checkCooldown?: boolean;
}

function intersects(left: string[], right: string[]): boolean {
  return left.some((item) => right.includes(item));
}

export async function getGroupAccountScope(group: GroupRecord): Promise<GroupAccountScope> {
  const [channelPermissions, accountRules] = await Promise.all([
    db
      .select()
      .from(groupChannelPermissions)
      .where(and(eq(groupChannelPermissions.groupId, group.id), eq(groupChannelPermissions.enabled, true))),
    db.select().from(groupAccountRules).where(eq(groupAccountRules.groupId, group.id))
  ]);

  return {
    allowedChannelIds: new Set(channelPermissions.map((permission) => permission.channelId)),
    ruleByChannelId: new Map(accountRules.map((rule) => [rule.channelId, rule]))
  };
}

export function accountMatchesRule(
  account: AccountRecord,
  rule?: GroupAccountRuleRecord,
  options: AccountMatchOptions = {}
): boolean {
  const checkConcurrency = options.checkConcurrency ?? true;
  const checkCooldown = options.checkCooldown ?? true;

  if (account.status !== "enabled") {
    return false;
  }

  if (account.healthStatus === "disabled") {
    return false;
  }

  if (checkCooldown && account.cooldownUntil && new Date(account.cooldownUntil).getTime() > Date.now()) {
    return false;
  }

  if (checkConcurrency && account.currentConcurrency >= account.concurrencyLimit) {
    return false;
  }

  if (rule?.allowedTags.length && !intersects(account.tags, rule.allowedTags)) {
    return false;
  }

  if (rule?.blockedTags.length && intersects(account.tags, rule.blockedTags)) {
    return false;
  }

  if (rule?.allowedAccountIds.length && !rule.allowedAccountIds.includes(account.id)) {
    return false;
  }

  if (rule?.blockedAccountIds.includes(account.id)) {
    return false;
  }

  return true;
}

export function accountMatchesGroupScope(
  account: AccountRecord,
  scope: GroupAccountScope,
  options: AccountMatchOptions = {}
): boolean {
  return scope.allowedChannelIds.has(account.channelId) && accountMatchesRule(account, scope.ruleByChannelId.get(account.channelId), options);
}
