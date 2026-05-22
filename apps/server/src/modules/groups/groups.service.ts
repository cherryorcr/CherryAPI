import { and, eq } from "drizzle-orm";
import { db } from "../../database/client";
import {
  accountModelAliases,
  accountModelCapabilities,
  accounts,
  channels,
  groupAccountRules,
  groupChannelPermissions,
  groupModelBindings,
  groupModelPermissions,
  groups,
  type AccountRecord,
  type GroupModelBindingRecord,
  type NewGroupModelBindingRecord,
  type NewGroupRecord
} from "../../database/schema";
import { GatewayError } from "../../core/errors";
import { accountMatchesGroupScope, getGroupAccountScope } from "../../core/group-account-scope";
import { pruneInvalidAccountAliasGroupBindings } from "../../core/group-model-binding-sync";
import { createId } from "../../utils/id";
import {
  bodyObject,
  booleanValue,
  jsonValue,
  listBody,
  nowIso,
  numberValue,
  optionalString,
  stringValue
} from "../common/body";

export async function listGroups() {
  return db.select().from(groups);
}

export async function getGroup(id: string) {
  const group = await db.select().from(groups).where(eq(groups.id, id)).get();
  if (!group) {
    throw new GatewayError("NOT_FOUND", "Group not found", 404);
  }
  return group;
}

export async function createGroup(input: unknown) {
  const body = bodyObject(input);
  const record: NewGroupRecord = {
    id: createId("grp"),
    name: stringValue(body, "name"),
    description: optionalString(body, "description") ?? null,
    status: stringValue(body, "status", "status", "enabled")
  };
  await db.insert(groups).values(record);
  return getGroup(record.id);
}

export async function updateGroup(id: string, input: unknown) {
  const body = bodyObject(input);
  const patch: Partial<NewGroupRecord> = { updatedAt: nowIso() };
  if (body.name !== undefined) patch.name = stringValue(body, "name");
  if (body.description !== undefined) patch.description = optionalString(body, "description") ?? null;
  if (body.status !== undefined) patch.status = stringValue(body, "status");
  await db.update(groups).set(patch).where(eq(groups.id, id));
  return getGroup(id);
}

export async function deleteGroup(id: string) {
  await getGroup(id);
  await db.delete(groups).where(eq(groups.id, id));
  return { ok: true };
}

export async function getGroupModelPermissions(groupId: string) {
  await getGroup(groupId);
  return db.select().from(groupModelPermissions).where(eq(groupModelPermissions.groupId, groupId));
}

export async function putGroupModelPermissions(groupId: string, input: unknown) {
  await getGroup(groupId);
  const permissions = listBody(input, "permissions");
  await db.delete(groupModelPermissions).where(eq(groupModelPermissions.groupId, groupId));
  for (const permission of permissions) {
    await db.insert(groupModelPermissions).values({
      id: createId("gmp"),
      groupId,
      modelId: stringValue(permission, "modelId", "model_id"),
      enabled: booleanValue(permission, "enabled", "enabled", true),
      rpmLimit: permission.rpmLimit === undefined && permission.rpm_limit === undefined ? null : Number(permission.rpmLimit ?? permission.rpm_limit),
      tpmLimit: permission.tpmLimit === undefined && permission.tpm_limit === undefined ? null : Number(permission.tpmLimit ?? permission.tpm_limit),
      dailyQuota: permission.dailyQuota === undefined && permission.daily_quota === undefined ? null : Number(permission.dailyQuota ?? permission.daily_quota),
      priceMultiplier: permission.priceMultiplier === undefined && permission.price_multiplier === undefined ? 100 : Number(permission.priceMultiplier ?? permission.price_multiplier)
    });
  }
  return getGroupModelPermissions(groupId);
}

export async function getGroupChannelPermissions(groupId: string) {
  await getGroup(groupId);
  return db.select().from(groupChannelPermissions).where(eq(groupChannelPermissions.groupId, groupId));
}

export async function putGroupChannelPermissions(groupId: string, input: unknown) {
  await getGroup(groupId);
  const permissions = listBody(input, "permissions");
  await db.delete(groupChannelPermissions).where(eq(groupChannelPermissions.groupId, groupId));
  for (const permission of permissions) {
    await db.insert(groupChannelPermissions).values({
      id: createId("gcp"),
      groupId,
      channelId: stringValue(permission, "channelId", "channel_id"),
      enabled: booleanValue(permission, "enabled", "enabled", true)
    });
  }
  return getGroupChannelPermissions(groupId);
}

export async function getGroupAccountRules(groupId: string) {
  await getGroup(groupId);
  return db.select().from(groupAccountRules).where(eq(groupAccountRules.groupId, groupId));
}

export async function putGroupAccountRules(groupId: string, input: unknown) {
  await getGroup(groupId);
  const rules = listBody(input, "rules");
  await db.delete(groupAccountRules).where(eq(groupAccountRules.groupId, groupId));
  for (const rule of rules) {
    const channelId = stringValue(rule, "channelId", "channel_id");
    await db.insert(groupAccountRules).values({
      id: createId("gar"),
      groupId,
      channelId,
      allowedTags: jsonValue(rule, "allowedTags", "allowed_tags", []),
      blockedTags: jsonValue(rule, "blockedTags", "blocked_tags", []),
      allowedAccountIds: jsonValue(rule, "allowedAccountIds", "allowed_account_ids", []),
      blockedAccountIds: jsonValue(rule, "blockedAccountIds", "blocked_account_ids", [])
    });
  }
  return getGroupAccountRules(groupId);
}

function sanitizeAccount(account: AccountRecord) {
  const { credentialEncrypted: _credentialEncrypted, ...safe } = account;
  return {
    ...safe,
    hasCredential: true
  };
}

const GROUP_ADMIN_ACCOUNT_MATCH_OPTIONS = {
  checkConcurrency: false,
  checkCooldown: false
} as const;

export async function getGroupEffectiveModels(groupId: string) {
  const group = await getGroup(groupId);
  const [
    channelPermissions,
    accountRules,
    allAccounts,
    capabilities,
    modelBindings
  ] = await Promise.all([
    db.select().from(groupChannelPermissions).where(eq(groupChannelPermissions.groupId, group.id)),
    db.select().from(groupAccountRules).where(eq(groupAccountRules.groupId, group.id)),
    db.select().from(accounts),
    db.select().from(accountModelCapabilities),
    db.select().from(groupModelBindings).where(eq(groupModelBindings.groupId, group.id))
  ]);

  const allowedChannelIds = new Set(
    channelPermissions.filter((permission) => permission.enabled).map((permission) => permission.channelId)
  );
  const scope = {
    allowedChannelIds,
    ruleByChannelId: new Map(accountRules.map((rule) => [rule.channelId, rule]))
  };
  const effectiveAccounts = allAccounts.filter(
    (account) => accountMatchesGroupScope(account, scope, GROUP_ADMIN_ACCOUNT_MATCH_OPTIONS)
  );
  const effectiveAccountIds = new Set(effectiveAccounts.map((account) => account.id));
  const effectiveCapabilities = capabilities.filter(
    (capability) => capability.status === "available" && effectiveAccountIds.has(capability.accountId)
  );
  const effectiveCapabilityKeys = new Set(
    effectiveCapabilities.map((capability) => capabilityKey(capability.accountId, capability.upstreamModelName))
  );
  const upstreamModels = new Map<
    string,
    {
      upstreamModelName: string;
      displayName: string | null;
      channelIds: string[];
      accountIds: string[];
      lastCheckedAt: string | null;
    }
  >();

  for (const capability of effectiveCapabilities) {
    const existing = upstreamModels.get(capability.upstreamModelName);
    if (existing) {
      if (!existing.channelIds.includes(capability.channelId)) {
        existing.channelIds.push(capability.channelId);
      }
      if (!existing.accountIds.includes(capability.accountId)) {
        existing.accountIds.push(capability.accountId);
      }
      if (
        capability.lastCheckedAt &&
        (!existing.lastCheckedAt || new Date(capability.lastCheckedAt).getTime() > new Date(existing.lastCheckedAt).getTime())
      ) {
        existing.lastCheckedAt = capability.lastCheckedAt;
      }
      continue;
    }

    upstreamModels.set(capability.upstreamModelName, {
      upstreamModelName: capability.upstreamModelName,
      displayName: capability.displayName,
      channelIds: [capability.channelId],
      accountIds: [capability.accountId],
      lastCheckedAt: capability.lastCheckedAt
    });
  }

  const exposedPublicModelByName = new Map<
    string,
    {
      id: string;
      publicName: string;
      displayName: string;
      status: string;
    }
  >();

  for (const binding of modelBindings) {
    if (!binding.enabled || exposedPublicModelByName.has(binding.publicModel)) {
      continue;
    }
    if (
      !effectiveAccountIds.has(binding.accountId) ||
      !allowedChannelIds.has(binding.channelId) ||
      !effectiveCapabilityKeys.has(capabilityKey(binding.accountId, binding.upstreamModelName))
    ) {
      continue;
    }
    exposedPublicModelByName.set(binding.publicModel, {
      id: `gmb:${binding.publicModel}`,
      publicName: binding.publicModel,
      displayName: binding.publicModel,
      status: "enabled"
    });
  }

  const exposedPublicModels = [...exposedPublicModelByName.values()].sort((left, right) =>
    left.publicName.localeCompare(right.publicName)
  );

  return {
    group,
    allowedChannelIds: [...allowedChannelIds],
    accountRules,
    effectiveAccounts: effectiveAccounts.map(sanitizeAccount),
    effectiveUpstreamModels: [...upstreamModels.values()].sort((left, right) =>
      left.upstreamModelName.localeCompare(right.upstreamModelName)
    ),
    exposedPublicModels
  };
}

export async function upsertDefaultPermissions(groupId: string, modelId: string, channelId: string) {
  const existingModelPermission = await db
    .select()
    .from(groupModelPermissions)
    .where(and(eq(groupModelPermissions.groupId, groupId), eq(groupModelPermissions.modelId, modelId)))
    .get();
  if (!existingModelPermission) {
    await db.insert(groupModelPermissions).values({
      id: createId("gmp"),
      groupId,
      modelId,
      enabled: true
    });
  }

  const existingChannelPermission = await db
    .select()
    .from(groupChannelPermissions)
    .where(and(eq(groupChannelPermissions.groupId, groupId), eq(groupChannelPermissions.channelId, channelId)))
    .get();
  if (!existingChannelPermission) {
    await db.insert(groupChannelPermissions).values({
      id: createId("gcp"),
      groupId,
      channelId,
      enabled: true
    });
  }
}

type BindingSource = "detected" | "account_alias" | "group_custom";

interface GroupModelCandidate {
  accountId: string;
  accountName: string;
  channelId: string;
  channelName: string;
  upstreamModel: string;
  source: BindingSource;
  capabilityId: string | null;
  discoveryMode: string | null;
  discoverySource: string | null;
  selected: boolean;
  enabled: boolean;
  bindingId: string | null;
  priority: number;
  accountPriority: number;
  weight: number;
  available: boolean;
  stale: boolean;
  staleReason: string | null;
  lastCheckedAt: string | null;
}

function bindingSource(value: unknown): BindingSource {
  if (value === "detected" || value === "account_alias" || value === "group_custom") {
    return value;
  }
  return "group_custom";
}

function stringFromKeys(input: Record<string, unknown>, keys: string[], label: string): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw new GatewayError("VALIDATION_ERROR", `${label} is required`, 400);
}

function candidateKey(publicModel: string, accountId: string, upstreamModel: string, source: string): string {
  return `${publicModel}\u0000${accountId}\u0000${upstreamModel}\u0000${source}`;
}

function capabilityKey(accountId: string, upstreamModel: string): string {
  return `${accountId}\u0000${upstreamModel}`;
}

function accountAliasKey(accountId: string, publicModel: string, upstreamModel: string): string {
  return `${accountId}\u0000${publicModel}\u0000${upstreamModel}`;
}

function selectedBinding(
  bindings: GroupModelBindingRecord[],
  publicModel: string,
  accountId: string,
  upstreamModel: string,
  source: BindingSource
): GroupModelBindingRecord | undefined {
  return bindings.find(
    (binding) =>
      binding.publicModel === publicModel &&
      binding.accountId === accountId &&
      binding.upstreamModelName === upstreamModel &&
      binding.source === source
  );
}

function sortCandidateGroups(
  groupsByPublicModel: Map<string, { publicModel: string; sources: BindingSource[]; candidates: GroupModelCandidate[] }>
) {
  return [...groupsByPublicModel.values()]
    .map((group) => ({
      ...group,
      sources: [...new Set(group.sources)].sort(),
      candidates: group.candidates.sort((left, right) => {
        if (left.source !== right.source) return left.source.localeCompare(right.source);
        if (left.channelName !== right.channelName) return left.channelName.localeCompare(right.channelName);
        if (left.accountName !== right.accountName) return left.accountName.localeCompare(right.accountName);
        return left.upstreamModel.localeCompare(right.upstreamModel);
      })
    }))
    .sort((left, right) => left.publicModel.localeCompare(right.publicModel));
}

export async function getGroupModelBindings(groupId: string) {
  await getGroup(groupId);
  await pruneInvalidAccountAliasGroupBindings();
  return db.select().from(groupModelBindings).where(eq(groupModelBindings.groupId, groupId));
}

export async function buildGroupModelCandidates(groupId: string) {
  const group = await getGroup(groupId);
  await pruneInvalidAccountAliasGroupBindings();
  const [allAccounts, allChannels, allCapabilities, aliases, bindings] = await Promise.all([
    db.select().from(accounts),
    db.select().from(channels),
    db.select().from(accountModelCapabilities),
    db.select().from(accountModelAliases),
    db.select().from(groupModelBindings).where(eq(groupModelBindings.groupId, group.id))
  ]);

  const scope = await getGroupAccountScope(group);
  const channelById = new Map(allChannels.map((channel) => [channel.id, channel]));
  const accountById = new Map(allAccounts.map((account) => [account.id, account]));
  const matchedAccounts = allAccounts.filter((account) =>
    accountMatchesGroupScope(account, scope, GROUP_ADMIN_ACCOUNT_MATCH_OPTIONS)
  );
  const matchedAccountIds = new Set(matchedAccounts.map((account) => account.id));
  const availableCapabilities = allCapabilities.filter(
    (capability) => matchedAccountIds.has(capability.accountId) && capability.status === "available"
  );
  const capabilityByAccountModel = new Map(
    availableCapabilities.map((capability) => [capabilityKey(capability.accountId, capability.upstreamModelName), capability])
  );
  const enabledAliasKeys = new Set(
    aliases
      .filter((alias) => alias.enabled)
      .map((alias) => accountAliasKey(alias.accountId, alias.publicModel, alias.upstreamModelName))
  );
  const candidateKeys = new Set<string>();
  const groupsByPublicModel = new Map<
    string,
    { publicModel: string; sources: BindingSource[]; candidates: GroupModelCandidate[] }
  >();

  function pushCandidate(
    publicModel: string,
    account: AccountRecord,
    upstreamModel: string,
    source: BindingSource,
    stale: boolean,
    staleReason: string | null
  ) {
    const channel = channelById.get(account.channelId);
    const capability = capabilityByAccountModel.get(capabilityKey(account.id, upstreamModel));
    const binding = selectedBinding(bindings, publicModel, account.id, upstreamModel, source);
    const selected = binding ? binding.enabled : false;
    const key = candidateKey(publicModel, account.id, upstreamModel, source);
    if (candidateKeys.has(key)) {
      return;
    }
    candidateKeys.add(key);

    const modelGroup = groupsByPublicModel.get(publicModel) ?? {
      publicModel,
      sources: [],
      candidates: []
    };
    modelGroup.sources.push(source);
    modelGroup.candidates.push({
      accountId: account.id,
      accountName: account.name,
      channelId: account.channelId,
      channelName: channel?.name ?? account.channelId,
      upstreamModel,
      source,
      capabilityId: capability?.id ?? null,
      discoveryMode: capability?.discoveryMode ?? capability?.source ?? null,
      discoverySource: capability?.discoverySource ?? capability?.source ?? null,
      selected,
      enabled: selected,
      bindingId: binding?.id ?? null,
      priority: binding?.priority ?? 100,
      accountPriority: binding?.accountPriority ?? 100,
      weight: binding?.weight ?? 1,
      available: Boolean(capability),
      stale,
      staleReason,
      lastCheckedAt: capability?.lastCheckedAt ?? null
    });
    groupsByPublicModel.set(publicModel, modelGroup);
  }

  for (const capability of availableCapabilities) {
    const account = accountById.get(capability.accountId);
    if (!account) continue;
    pushCandidate(capability.upstreamModelName, account, capability.upstreamModelName, "detected", false, null);
  }

  for (const alias of aliases) {
    if (!alias.enabled || !matchedAccountIds.has(alias.accountId)) {
      continue;
    }
    const account = accountById.get(alias.accountId);
    if (!account) continue;
    const capability = capabilityByAccountModel.get(capabilityKey(alias.accountId, alias.upstreamModelName));
    if (!capability) {
      continue;
    }
    pushCandidate(alias.publicModel, account, alias.upstreamModelName, "account_alias", false, null);
  }

  for (const binding of bindings) {
    const source = bindingSource(binding.source);
    if (
      source === "account_alias" &&
      !enabledAliasKeys.has(accountAliasKey(binding.accountId, binding.publicModel, binding.upstreamModelName))
    ) {
      continue;
    }
    const account = accountById.get(binding.accountId);
    if (!account) {
      continue;
    }
    const channel = channelById.get(binding.channelId);
    const scopeMatches =
      account.channelId === binding.channelId &&
      channel?.status === "enabled" &&
      accountMatchesGroupScope(account, scope, GROUP_ADMIN_ACCOUNT_MATCH_OPTIONS);
    const capability = capabilityByAccountModel.get(capabilityKey(binding.accountId, binding.upstreamModelName));
    const staleReason = !scopeMatches
      ? "Account no longer matches group channel/tag scope or channel is disabled."
      : !capability
        ? "Account no longer has this upstream model available."
        : null;
    pushCandidate(binding.publicModel, account, binding.upstreamModelName, source, Boolean(staleReason), staleReason);
  }

  return {
    group,
    allowedChannelIds: [...scope.allowedChannelIds],
    accountRules: [...scope.ruleByChannelId.values()],
    matchedAccounts: matchedAccounts.map(sanitizeAccount),
    models: sortCandidateGroups(groupsByPublicModel),
    bindings
  };
}

export async function putGroupModelBindings(groupId: string, input: unknown) {
  const group = await getGroup(groupId);
  const body = bodyObject(input);
  const requestedBindings = listBody(body, "bindings");
  await pruneInvalidAccountAliasGroupBindings();
  const [allAccounts, allChannels, availableCapabilities, aliases] = await Promise.all([
    db.select().from(accounts),
    db.select().from(channels),
    db.select().from(accountModelCapabilities).where(eq(accountModelCapabilities.status, "available")),
    db.select().from(accountModelAliases)
  ]);
  const scope = await getGroupAccountScope(group);
  const accountById = new Map(allAccounts.map((account) => [account.id, account]));
  const channelById = new Map(allChannels.map((channel) => [channel.id, channel]));
  const capabilityByAccountModel = new Map(
    availableCapabilities.map((capability) => [capabilityKey(capability.accountId, capability.upstreamModelName), capability])
  );
  const enabledAliasKeys = new Set(
    aliases
      .filter((alias) => alias.enabled)
      .map((alias) => accountAliasKey(alias.accountId, alias.publicModel, alias.upstreamModelName))
  );
  const deduped = new Map<string, NewGroupModelBindingRecord>();

  for (const item of requestedBindings) {
    const publicModel = stringValue(item, "publicModel", "public_model").trim();
    const upstreamModelName = stringFromKeys(
      item,
      ["upstreamModel", "upstream_model", "upstreamModelName", "upstream_model_name"],
      "upstreamModel"
    );
    const accountId = stringValue(item, "accountId", "account_id");
    const channelId = stringValue(item, "channelId", "channel_id");
    const source = bindingSource(item.source);
    const enabled = booleanValue(item, "enabled", "enabled", true);

    if (!publicModel || !upstreamModelName) {
      throw new GatewayError("VALIDATION_ERROR", "public_model and upstream_model are required", 400);
    }

    const account = accountById.get(accountId);
    const channel = channelById.get(channelId);
    if (!account || !channel || account.channelId !== channel.id) {
      throw new GatewayError("VALIDATION_ERROR", "Binding account/channel is invalid", 400);
    }

    if (enabled) {
      if (channel.status !== "enabled") {
        throw new GatewayError("VALIDATION_ERROR", "Enabled binding channel must be enabled", 400);
      }
      if (!accountMatchesGroupScope(account, scope, GROUP_ADMIN_ACCOUNT_MATCH_OPTIONS)) {
        throw new GatewayError("VALIDATION_ERROR", "Enabled binding account must match the group's channel and tag scope", 400);
      }
      if (!capabilityByAccountModel.has(capabilityKey(account.id, upstreamModelName))) {
        throw new GatewayError("VALIDATION_ERROR", "Enabled binding upstream_model must be available on the account", 400);
      }
      if (source === "account_alias" && !enabledAliasKeys.has(accountAliasKey(account.id, publicModel, upstreamModelName))) {
        throw new GatewayError("VALIDATION_ERROR", "Enabled account_alias binding must match an enabled account model alias", 400);
      }
    }

    const now = nowIso();
    const key = candidateKey(publicModel, accountId, upstreamModelName, source);
    deduped.set(key, {
      id: createId("gmb"),
      groupId,
      publicModel,
      upstreamModelName,
      channelId,
      accountId,
      source,
      enabled,
      priority: numberValue(item, "priority", "priority", 100),
      accountPriority: numberValue(item, "accountPriority", "account_priority", 100),
      weight: numberValue(item, "weight", "weight", 1),
      createdAt: now,
      updatedAt: now
    });
  }

  await db.delete(groupModelBindings).where(eq(groupModelBindings.groupId, groupId));
  const values = [...deduped.values()];
  if (values.length) {
    await db.insert(groupModelBindings).values(values);
  }
  return getGroupModelBindings(groupId);
}
