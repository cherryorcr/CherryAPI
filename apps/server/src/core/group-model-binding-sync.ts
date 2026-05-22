import { and, eq } from "drizzle-orm";
import { db } from "../database/client";
import { accountModelAliases, groupModelBindings } from "../database/schema";

function aliasBindingKey(accountId: string, publicModel: string, upstreamModelName: string): string {
  return `${accountId}\u0000${publicModel}\u0000${upstreamModelName}`;
}

export async function pruneInvalidAccountAliasGroupBindings(accountId?: string): Promise<{ deleted: number }> {
  const aliasRows = accountId
    ? await db.select().from(accountModelAliases).where(eq(accountModelAliases.accountId, accountId))
    : await db.select().from(accountModelAliases);
  const bindingRows = accountId
    ? await db
        .select()
        .from(groupModelBindings)
        .where(and(eq(groupModelBindings.source, "account_alias"), eq(groupModelBindings.accountId, accountId)))
    : await db.select().from(groupModelBindings).where(eq(groupModelBindings.source, "account_alias"));

  const enabledAliasKeys = new Set(
    aliasRows
      .filter((alias) => alias.enabled)
      .map((alias) => aliasBindingKey(alias.accountId, alias.publicModel, alias.upstreamModelName))
  );
  const invalidBindings = bindingRows.filter(
    (binding) => !enabledAliasKeys.has(aliasBindingKey(binding.accountId, binding.publicModel, binding.upstreamModelName))
  );

  for (const binding of invalidBindings) {
    await db.delete(groupModelBindings).where(eq(groupModelBindings.id, binding.id));
  }

  return { deleted: invalidBindings.length };
}
