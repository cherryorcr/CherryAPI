import { db } from "../../database/client";
import { accounts, channels, usageLogs } from "../../database/schema";

export async function getDashboardStats() {
  const [accountRows, usageRows] = await Promise.all([db.select().from(accounts), db.select().from(usageLogs)]);
  const successRequests = usageRows.filter((log) => log.status === "success").length;
  const failedRequests = usageRows.length - successRequests;

  return {
    totalRequests: usageRows.length,
    successRequests,
    failedRequests,
    successRate: usageRows.length === 0 ? 1 : successRequests / usageRows.length,
    totalTokens: usageRows.reduce((sum, log) => sum + log.totalTokens, 0),
    enabledAccounts: accountRows.filter((account) => account.status === "enabled").length,
    healthyAccounts: accountRows.filter((account) => account.healthStatus === "healthy").length,
    degradedAccounts: accountRows.filter((account) => account.healthStatus === "degraded").length,
    disabledAccounts: accountRows.filter((account) => account.status === "disabled" || account.healthStatus === "disabled").length
  };
}

export async function getChannelHealth() {
  const [channelRows, accountRows] = await Promise.all([db.select().from(channels), db.select().from(accounts)]);
  const now = Date.now();

  return channelRows.map((channel) => {
    const channelAccounts = accountRows.filter((account) => account.channelId === channel.id);
    return {
      channelId: channel.id,
      channelName: channel.name,
      totalAccounts: channelAccounts.length,
      healthy: channelAccounts.filter((account) => account.healthStatus === "healthy").length,
      degraded: channelAccounts.filter((account) => account.healthStatus === "degraded").length,
      disabled: channelAccounts.filter((account) => account.status === "disabled" || account.healthStatus === "disabled").length,
      cooldown: channelAccounts.filter((account) => account.cooldownUntil && new Date(account.cooldownUntil).getTime() > now).length
    };
  });
}
