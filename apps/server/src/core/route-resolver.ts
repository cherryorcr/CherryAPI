import type { OpenAIChatCompletionRequest } from "@cherryapi/shared";
import { and, eq } from "drizzle-orm";
import { adapterRegistry } from "../adapters/registry";
import type { ProviderAdapter } from "../adapters/types";
import { db } from "../database/client";
import {
  accountModelAliases,
  accountModelCapabilities,
  accounts,
  channels,
  groupModelBindings,
  type AccountRecord,
  type ApiKeyRecord,
  type ChannelRecord,
  type GroupModelBindingRecord,
  type GroupRecord,
  type ModelRecord,
  type ModelRouteRecord
} from "../database/schema";
import { accountScheduler } from "./account-scheduler";
import { GatewayError } from "./errors";
import { accountMatchesGroupScope, getGroupAccountScope } from "./group-account-scope";

export interface ResolvedRoute {
  model: ModelRecord;
  route: ModelRouteRecord;
  binding?: GroupModelBindingRecord;
  channel: ChannelRecord;
  account: AccountRecord;
  adapter: ProviderAdapter;
  upstreamModelName: string;
}

export interface ResolveOptions {
  excludeAccountIds?: Set<string>;
  excludeBindingIds?: Set<string>;
}

function bindingWeight(binding: GroupModelBindingRecord): number {
  return Math.max(1, binding.weight);
}

function weightedBindingPick(bindings: GroupModelBindingRecord[]): GroupModelBindingRecord | undefined {
  const total = bindings.reduce((sum, binding) => sum + bindingWeight(binding), 0);
  let cursor = Math.random() * total;
  for (const binding of bindings) {
    cursor -= bindingWeight(binding);
    if (cursor <= 0) {
      return binding;
    }
  }
  return bindings[0];
}

function bindingBuckets(bindings: GroupModelBindingRecord[]): GroupModelBindingRecord[][] {
  const sorted = [...bindings].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.accountPriority !== right.accountPriority) {
      return left.accountPriority - right.accountPriority;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });

  const buckets = new Map<string, GroupModelBindingRecord[]>();
  for (const binding of sorted) {
    const key = `${binding.priority}:${binding.accountPriority}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(binding);
    buckets.set(key, bucket);
  }

  return [...buckets.values()];
}

function syntheticModel(publicModel: string): ModelRecord {
  const now = new Date(0).toISOString();
  return {
    id: `gmb:${publicModel}`,
    publicName: publicModel,
    displayName: publicModel,
    description: null,
    capabilities: {},
    status: "enabled",
    createdAt: now,
    updatedAt: now
  };
}

function syntheticRoute(binding: GroupModelBindingRecord): ModelRouteRecord {
  return {
    id: binding.id,
    modelId: `gmb:${binding.publicModel}`,
    channelId: binding.channelId,
    upstreamModelName: binding.upstreamModelName,
    priority: binding.priority,
    weight: binding.weight,
    enabled: binding.enabled,
    fallbackOrder: 0,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt
  };
}

function capabilitiesMatch(
  request: OpenAIChatCompletionRequest,
  channel: ChannelRecord,
  adapter: ProviderAdapter
): boolean {
  const channelCapabilities = channel.capabilities ?? {};
  const adapterCapabilities = adapter.getCapabilities();
  const capabilities = { ...adapterCapabilities, ...channelCapabilities };

  if (!capabilities.chatCompletions) {
    return false;
  }

  if (request.stream && !capabilities.streaming) {
    return false;
  }

  if (request.tools && request.tools.length > 0 && capabilities.tools === false) {
    return false;
  }

  return true;
}

export class RouteResolver {
  async resolve(
    apiKey: ApiKeyRecord,
    group: GroupRecord,
    request: OpenAIChatCompletionRequest,
    options: ResolveOptions = {}
  ): Promise<ResolvedRoute> {
    const groupBindingRoute = await this.resolveGroupBinding(apiKey, group, request, options);
    if (groupBindingRoute) {
      return groupBindingRoute;
    }

    void apiKey;
    throw new GatewayError(
      "NO_AVAILABLE_ROUTE",
      `No enabled group model binding exists for model "${request.model}". Configure it in Groups -> Model Bindings.`,
      404
    );
  }

  private async resolveGroupBinding(
    apiKey: ApiKeyRecord,
    group: GroupRecord,
    request: OpenAIChatCompletionRequest,
    options: ResolveOptions
  ): Promise<ResolvedRoute | null> {
    const allBindings = await db
      .select()
      .from(groupModelBindings)
      .where(
        and(
          eq(groupModelBindings.groupId, group.id),
          eq(groupModelBindings.publicModel, request.model),
          eq(groupModelBindings.enabled, true)
        )
      );

    const bindings = allBindings.filter(
      (binding) =>
        !options.excludeBindingIds?.has(binding.id) &&
        !options.excludeAccountIds?.has(binding.accountId)
    );

    if (bindings.length === 0) {
      if (allBindings.length === 0) {
        return null;
      }
      throw new GatewayError("NO_AVAILABLE_ACCOUNT", "No untried group model binding account remains for this model", 503);
    }

    const scope = await getGroupAccountScope(group);
    let sawAdapterMissing = false;
    let sawChannelDenied = false;
    let sawCapabilityMissing = false;
    let sawAliasMissing = false;
    let sawAccountDenied = false;
    let sawRoute = false;

    for (const bucket of bindingBuckets(bindings)) {
      const pending = [...bucket];
      while (pending.length) {
        const binding = weightedBindingPick(pending);
        if (!binding) {
          break;
        }

        pending.splice(pending.findIndex((item) => item.id === binding.id), 1);
        const aliasLookup =
          binding.source === "account_alias"
            ? db
                .select()
                .from(accountModelAliases)
                .where(
                  and(
                    eq(accountModelAliases.accountId, binding.accountId),
                    eq(accountModelAliases.publicModel, binding.publicModel),
                    eq(accountModelAliases.upstreamModelName, binding.upstreamModelName),
                    eq(accountModelAliases.enabled, true)
                  )
                )
                .get()
            : Promise.resolve(null);
        const [channel, account, capability, alias] = await Promise.all([
          db.select().from(channels).where(eq(channels.id, binding.channelId)).get(),
          db.select().from(accounts).where(eq(accounts.id, binding.accountId)).get(),
          db
            .select()
            .from(accountModelCapabilities)
            .where(
              and(
                eq(accountModelCapabilities.accountId, binding.accountId),
                eq(accountModelCapabilities.upstreamModelName, binding.upstreamModelName),
                eq(accountModelCapabilities.status, "available")
              )
            )
            .get(),
          aliasLookup
        ]);

        if (!channel || channel.status !== "enabled") {
          continue;
        }

        sawRoute = true;
        const adapter = adapterRegistry.get(channel.adapterType);
        if (!adapter) {
          sawAdapterMissing = true;
          continue;
        }

        if (!scope.allowedChannelIds.has(channel.id)) {
          sawChannelDenied = true;
          continue;
        }

        if (!account || account.channelId !== channel.id || !accountMatchesGroupScope(account, scope)) {
          sawAccountDenied = true;
          continue;
        }

        if (!capability) {
          sawCapabilityMissing = true;
          continue;
        }

        if (binding.source === "account_alias" && !alias) {
          sawAliasMissing = true;
          continue;
        }

        if (!capabilitiesMatch(request, channel, adapter)) {
          continue;
        }

        const checkedOutAccount = await accountScheduler.checkoutAccount(binding.accountId, channel, group);
        if (!checkedOutAccount) {
          sawAccountDenied = true;
          continue;
        }

        void apiKey;
        return {
          model: syntheticModel(binding.publicModel),
          route: syntheticRoute(binding),
          binding,
          channel,
          account: checkedOutAccount,
          adapter,
          upstreamModelName: binding.upstreamModelName
        };
      }
    }

    if (sawAdapterMissing) {
      throw new GatewayError("ADAPTER_NOT_FOUND", "Adapter was not found for an enabled group model binding", 500);
    }

    if (sawChannelDenied) {
      throw new GatewayError("CHANNEL_NOT_ALLOWED", "No group model binding channel is allowed for this group", 403);
    }

    if (sawCapabilityMissing) {
      throw new GatewayError("NO_AVAILABLE_ROUTE", "No enabled group model binding has an available account model capability", 404);
    }

    if (sawAliasMissing) {
      throw new GatewayError("NO_AVAILABLE_ROUTE", "No enabled group model binding matches an enabled account model alias", 404);
    }

    if (sawAccountDenied || sawRoute) {
      throw new GatewayError("NO_AVAILABLE_ACCOUNT", "No available account exists for this group model binding", 503);
    }

    throw new GatewayError("NO_AVAILABLE_ROUTE", "No available group model binding exists for this model", 404);
  }
}

export const routeResolver = new RouteResolver();
