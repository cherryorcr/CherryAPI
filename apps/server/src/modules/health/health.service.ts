import { db } from "../../database/client";
import { accounts, channels, usageLogs } from "../../database/schema";
import { adapterRegistry } from "../../adapters/registry";

export async function getHealth() {
  const channelRows = await db.select().from(channels);
  const accountRows = await db.select().from(accounts);
  const logs = await db.select().from(usageLogs).limit(500);
  const successful = logs.filter((log) => log.status === "success").length;

  return {
    status: "ok",
    adapters: adapterRegistry.list().map((adapter) => ({
      type: adapter.type,
      capabilities: adapter.getCapabilities()
    })),
    counts: {
      channels: channelRows.length,
      accounts: accountRows.length,
      healthyAccounts: accountRows.filter((account) => account.healthStatus === "healthy").length,
      usageLogs: logs.length
    },
    successRate: logs.length === 0 ? 1 : successful / logs.length
  };
}
