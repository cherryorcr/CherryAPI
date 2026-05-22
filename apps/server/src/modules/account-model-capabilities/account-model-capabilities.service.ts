import { and, eq } from "drizzle-orm";
import { adapterRegistry } from "../../adapters/registry";
import type { DetectedModel, ModelTestResult } from "../../adapters/types";
import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { db } from "../../database/client";
import {
  accountModelCapabilities,
  accounts,
  channels,
  modelRoutes,
  models,
  type AccountModelCapabilityRecord,
  type AccountRecord,
  type ChannelRecord,
  type NewAccountModelCapabilityRecord,
  type NewModelRecord,
  type NewModelRouteRecord
} from "../../database/schema";
import { createId } from "../../utils/id";
import { inferPlatformIdFromChannel } from "@cherryapi/shared";
import { sanitizeAccount } from "../accounts/accounts.service";
import {
  booleanValue,
  bodyObject,
  jsonValue,
  nowIso,
  numberValue,
  optionalJsonValue,
  optionalNumber,
  optionalString,
  stringValue
} from "../common/body";

type CapabilityStatus = "available" | "unavailable" | "unknown";
type DetectionSource = "upstream_list" | "candidate_probe" | "manual";
type DetectionMode = "upstream_list" | "candidate_probe" | "mixed" | "none";
type DetectionProgressStatus = "listing" | "testing" | "completed" | "failed";

export interface AccountModelDetectionProgress {
  requestId: string;
  accountId: string | null;
  channelId: string | null;
  status: DetectionProgressStatus;
  total: number | null;
  completed: number;
  currentModel: string | null;
  startedAt: string;
  updatedAt: string;
  error: string | null;
}

const DETECTION_PROGRESS_TTL_MS = 15 * 60 * 1000;
const detectionProgressByRequestId = new Map<string, AccountModelDetectionProgress>();

function pruneDetectionProgress(): void {
  const now = Date.now();
  for (const [requestId, progress] of detectionProgressByRequestId.entries()) {
    const updatedAt = Date.parse(progress.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt > DETECTION_PROGRESS_TTL_MS) {
      detectionProgressByRequestId.delete(requestId);
    }
  }
}

function updateDetectionProgress(
  requestId: string,
  patch: Partial<Omit<AccountModelDetectionProgress, "requestId" | "startedAt" | "updatedAt">>
): AccountModelDetectionProgress {
  pruneDetectionProgress();
  const now = nowIso();
  const previous = detectionProgressByRequestId.get(requestId);
  const progress: AccountModelDetectionProgress = {
    requestId,
    accountId: previous?.accountId ?? null,
    channelId: previous?.channelId ?? null,
    status: previous?.status ?? "listing",
    total: previous?.total ?? null,
    completed: previous?.completed ?? 0,
    currentModel: previous?.currentModel ?? null,
    error: previous?.error ?? null,
    ...patch,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now
  };
  detectionProgressByRequestId.set(requestId, progress);
  return progress;
}

export function getAccountModelDetectionProgress(requestId: string): AccountModelDetectionProgress | null {
  pruneDetectionProgress();
  return detectionProgressByRequestId.get(requestId) ?? null;
}

function requestIdFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const requestId = (input as Record<string, unknown>).requestId;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) {
    return undefined;
  }
  return requestId;
}

function trimError(error: string | null | undefined): string | null {
  if (!error) {
    return null;
  }
  return error.length > 1000 ? `${error.slice(0, 1000)}...` : error;
}

function normalizedSource(source: string | null | undefined): DetectionSource {
  if (source === "upstream_list" || source === "detected") {
    return "upstream_list";
  }
  if (source === "candidate_probe" || source === "candidate") {
    return "candidate_probe";
  }
  return "manual";
}

function statusValue(value: unknown, fallback: CapabilityStatus = "unknown"): CapabilityStatus {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === "available" || value === "unavailable" || value === "unknown") {
    return value;
  }
  throw new GatewayError("VALIDATION_ERROR", "status must be available, unavailable, or unknown", 400);
}

function selectedModelsFromInput(input: unknown): DetectedModel[] {
  const body = bodyObject(input);
  const value = body.models ?? body.upstreamModels ?? body.upstream_model_names;
  if (!Array.isArray(value)) {
    throw new GatewayError("VALIDATION_ERROR", "models array is required", 400);
  }

  const selected = new Map<string, DetectedModel>();
  for (const item of value) {
    if (typeof item === "string") {
      mergeDetectedModel(selected, {
        upstreamModelName: item,
        displayName: item,
        source: "upstream_list"
      });
      continue;
    }

    const record = bodyObject(item);
    const upstreamModelName = stringValue(record, "upstreamModelName", "upstream_model_name");
    mergeDetectedModel(selected, {
      upstreamModelName,
      displayName: optionalString(record, "displayName", "display_name") ?? upstreamModelName,
      capabilities: jsonValue<Record<string, unknown>>(record, "capabilities", "capabilities", {}),
      source: normalizedSource(optionalString(record, "source", "source") ?? "upstream_list")
    });
  }

  const models = [...selected.values()].sort((left, right) => left.upstreamModelName.localeCompare(right.upstreamModelName));
  if (models.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "At least one model must be selected", 400);
  }
  return models;
}

async function getRawAccount(id: string): Promise<AccountRecord> {
  const account = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) {
    throw new GatewayError("NOT_FOUND", "Account not found", 404);
  }
  return account;
}

async function getAccountChannel(account: AccountRecord): Promise<ChannelRecord> {
  const channel = await db.select().from(channels).where(eq(channels.id, account.channelId)).get();
  if (!channel) {
    throw new GatewayError("NOT_FOUND", "Channel not found for account", 404);
  }
  return channel;
}

async function getCapability(id: string): Promise<AccountModelCapabilityRecord> {
  const capability = await db
    .select()
    .from(accountModelCapabilities)
    .where(eq(accountModelCapabilities.id, id))
    .get();
  if (!capability) {
    throw new GatewayError("NOT_FOUND", "Account model capability not found", 404);
  }
  return capability;
}

function mergeDetectedModel(target: Map<string, DetectedModel>, model: DetectedModel): void {
  const key = model.upstreamModelName.trim();
  if (!key) {
    return;
  }
  const existing = target.get(key);
  target.set(key, {
    ...existing,
    ...model,
    upstreamModelName: key,
    capabilities: {
      ...(existing?.capabilities ?? {}),
      ...(model.capabilities ?? {})
    }
  });
}

async function upsertCapability(
  account: AccountRecord,
  detected: DetectedModel,
  test: ModelTestResult,
  source: DetectionSource,
  verifiedByTest: boolean,
  warnings: string[]
): Promise<AccountModelCapabilityRecord> {
  const now = nowIso();
  const existing = await db
    .select()
    .from(accountModelCapabilities)
    .where(
      and(
        eq(accountModelCapabilities.accountId, account.id),
        eq(accountModelCapabilities.upstreamModelName, detected.upstreamModelName)
      )
    )
    .get();
  const capabilities = {
    ...(detected.capabilities ?? {}),
    ...(test.capabilities ?? {})
  };
  const patch: Partial<NewAccountModelCapabilityRecord> = {
    channelId: account.channelId,
    displayName: detected.displayName ?? existing?.displayName ?? detected.upstreamModelName,
    status: test.status,
    capabilities,
    lastCheckedAt: now,
    lastSuccessAt: test.status === "available" ? now : existing?.lastSuccessAt ?? null,
    lastError: test.status === "available" ? null : trimError(test.error),
    latencyMs: test.latencyMs ?? null,
    source,
    verifiedByTest,
    discoveryMode: source,
    discoverySource: source,
    warnings,
    raw: {
      detected,
      test
    },
    updatedAt: now
  };

  if (existing) {
    await db.update(accountModelCapabilities).set(patch).where(eq(accountModelCapabilities.id, existing.id));
    return getCapability(existing.id);
  }

  const record: NewAccountModelCapabilityRecord = {
    id: createId("amc"),
    accountId: account.id,
    upstreamModelName: detected.upstreamModelName,
    ...patch
  } as NewAccountModelCapabilityRecord;
  await db.insert(accountModelCapabilities).values(record);
  return getCapability(record.id);
}

async function ensureLegacyModel(capability: AccountModelCapabilityRecord): Promise<void> {
  if (capability.status !== "available") {
    return;
  }
  const existing = await db
    .select()
    .from(models)
    .where(eq(models.publicName, capability.upstreamModelName))
    .get();
  if (existing) {
    return;
  }

  await db.insert(models).values({
    id: createId("mdl"),
    publicName: capability.upstreamModelName,
    displayName: capability.displayName ?? capability.upstreamModelName,
    description: "Auto-created from detected account model capability.",
    capabilities: capability.capabilities,
    status: "enabled"
  });
}

async function deleteCandidateProbeCapabilities(accountId: string): Promise<void> {
  await db
    .delete(accountModelCapabilities)
    .where(
      and(
        eq(accountModelCapabilities.accountId, accountId),
        eq(accountModelCapabilities.source, "candidate_probe")
      )
    );
}

async function markMissingSyncedCapabilitiesUnavailable(
  account: AccountRecord,
  syncedModels: Set<string>
): Promise<void> {
  const now = nowIso();
  const existing = await db
    .select()
    .from(accountModelCapabilities)
    .where(eq(accountModelCapabilities.accountId, account.id));

  await Promise.all(
    existing
      .filter(
        (capability) =>
          capability.source === "upstream_list" &&
          !syncedModels.has(capability.upstreamModelName)
      )
      .map((capability) => {
        if (capability.status !== "available") {
          return db
            .delete(accountModelCapabilities)
            .where(eq(accountModelCapabilities.id, capability.id));
        }

        return db
          .update(accountModelCapabilities)
          .set({
            status: "unavailable",
            lastCheckedAt: now,
            lastError: "Model was not returned by the latest upstream model sync.",
            warnings: [
              ...(Array.isArray(capability.warnings) ? capability.warnings : []),
              "Model was not returned by the latest upstream model sync."
            ],
            raw: {
              previous: capability.raw,
              stale: true,
              reason: "not_returned_by_latest_upstream_model_sync"
            },
            updatedAt: now
          })
          .where(eq(accountModelCapabilities.id, capability.id));
      })
  );
}

export async function listAllAccountModelCapabilities() {
  return db.select().from(accountModelCapabilities);
}

export async function listAccountModelCapabilities(accountId: string) {
  await getRawAccount(accountId);
  return db
    .select()
    .from(accountModelCapabilities)
    .where(eq(accountModelCapabilities.accountId, accountId));
}

export async function listAccountModels(accountId: string, input?: unknown) {
  const requestId = requestIdFromInput(input) ?? createId("detect");
  updateDetectionProgress(requestId, {
    accountId,
    status: "listing",
    total: null,
    completed: 0,
    currentModel: null,
    error: null
  });

  try {
    const account = await getRawAccount(accountId);
    const channel = await getAccountChannel(account);
    const adapter = adapterRegistry.get(channel.adapterType);
    if (!adapter) {
      throw new GatewayError("ADAPTER_NOT_FOUND", "Adapter was not found for account channel", 500);
    }

    let listError: string | null = null;
    let upstreamListCount = 0;
    const detected = new Map<string, DetectedModel>();

    if (adapter.listModels) {
      try {
        const listedModels = await adapter.listModels(account, channel, { requestId });
        upstreamListCount = listedModels.length;
        for (const model of listedModels) {
          mergeDetectedModel(detected, { ...model, source: normalizedSource(model.source ?? "upstream_list") });
        }
      } catch (error) {
        listError = toSafeErrorMessage(error);
      }
    }

    const models = [...detected.values()].sort((left, right) => left.upstreamModelName.localeCompare(right.upstreamModelName));
    updateDetectionProgress(requestId, {
      accountId: account.id,
      channelId: channel.id,
      status: "completed",
      total: models.length,
      completed: models.length,
      currentModel: null,
      error: null
    });

    return {
      requestId,
      accountId: account.id,
      channelId: channel.id,
      listError: trimError(listError),
      models,
      account: sanitizeAccount(account),
      channel,
      platformId: inferPlatformIdFromChannel(channel),
      discovery: {
        mode: models.length > 0 ? ("upstream_list" as DetectionMode) : ("none" as DetectionMode),
        listSupported: Boolean(adapter.listModels),
        upstreamListCount,
        candidateProbeCount: 0,
        verifiedByTest: Boolean(adapter.testModel)
      },
      warnings: [
        ...(!adapter.listModels ? ["This adapter does not expose an upstream model-list API."] : []),
        ...(listError ? [`Upstream model-list error: ${trimError(listError)}`] : [])
      ]
    };
  } catch (error) {
    updateDetectionProgress(requestId, {
      status: "failed",
      currentModel: null,
      error: trimError(toSafeErrorMessage(error))
    });
    throw error;
  }
}

export async function detectAccountModels(accountId: string, input?: unknown) {
  const startedAt = Date.now();
  const requestId = requestIdFromInput(input) ?? createId("detect");
  updateDetectionProgress(requestId, {
    accountId,
    status: "listing",
    total: null,
    completed: 0,
    currentModel: null,
    error: null
  });

  try {
    const account = await getRawAccount(accountId);
    const channel = await getAccountChannel(account);
    updateDetectionProgress(requestId, {
      accountId: account.id,
      channelId: channel.id,
      status: "listing",
      total: null,
      completed: 0,
      currentModel: null,
      error: null
    });

    const adapter = adapterRegistry.get(channel.adapterType);
    if (!adapter) {
      throw new GatewayError("ADAPTER_NOT_FOUND", "Adapter was not found for account channel", 500);
    }

    const detected = new Map<string, DetectedModel>();
    let listError: string | null = null;
    let upstreamListCount = 0;

    if (adapter.listModels) {
      try {
        const listedModels = await adapter.listModels(account, channel, { requestId });
        upstreamListCount = listedModels.length;
        for (const model of listedModels) {
          mergeDetectedModel(detected, { ...model, source: normalizedSource(model.source ?? "upstream_list") });
        }
      } catch (error) {
        listError = toSafeErrorMessage(error);
      }
    }

    if (detected.size === 0) {
      const warnings = [
        adapter.listModels
          ? "The upstream model-list API returned no usable models. Model sync did not run candidate probes."
          : "This adapter does not expose an upstream model-list API. Model sync requires a real upstream model list.",
        ...(listError ? [`Upstream model-list error: ${trimError(listError)}`] : [])
      ];
      updateDetectionProgress(requestId, {
        status: "completed",
        total: 0,
        completed: 0,
        currentModel: null,
        error: null
      });
      return {
        requestId,
        accountId: account.id,
        channelId: channel.id,
        listError: trimError(listError),
        capabilities: [],
        account: sanitizeAccount(account),
        channel,
        platformId: inferPlatformIdFromChannel(channel),
        discovery: {
          mode: "none" as DetectionMode,
          listSupported: Boolean(adapter.listModels),
          upstreamListCount,
          candidateProbeCount: 0,
          verifiedByTest: Boolean(adapter.testModel)
        },
        warnings,
        summary: {
          total: 0,
          available: 0,
          unavailable: 0,
          unknown: 0,
          durationMs: Date.now() - startedAt
        },
        models: []
      };
    }

    await deleteCandidateProbeCapabilities(account.id);

    const candidateProbeCount = 0;
    const discoveryMode: DetectionMode = upstreamListCount > 0 ? "upstream_list" : "none";
    const warnings: string[] = [];
    if (listError) {
      warnings.push(`Upstream model-list error: ${trimError(listError)}`);
    }
    warnings.push("Synced models came from the upstream model-list API and were then tested with real requests.");
    const detectedModels = [...detected.values()];
    updateDetectionProgress(requestId, {
      status: "testing",
      total: detectedModels.length,
      completed: 0,
      currentModel: detectedModels[0]?.upstreamModelName ?? null,
      error: null
    });

    await markMissingSyncedCapabilitiesUnavailable(
      account,
      new Set(detectedModels.map((model) => model.upstreamModelName))
    );

    const saved: AccountModelCapabilityRecord[] = [];
    for (const [index, model] of detectedModels.entries()) {
      updateDetectionProgress(requestId, {
        status: "testing",
        total: detectedModels.length,
        completed: index,
        currentModel: model.upstreamModelName,
        error: null
      });
      const test = adapter.testModel
        ? await adapter.testModel(account, channel, model.upstreamModelName, { requestId })
        : {
            status: "unknown" as const,
            error: "Adapter does not support model ping tests"
          };
      const capability = await upsertCapability(account, model, test, normalizedSource(model.source), Boolean(adapter.testModel), warnings);
      saved.push(capability);
      await ensureLegacyModel(capability);
      updateDetectionProgress(requestId, {
        status: "testing",
        total: detectedModels.length,
        completed: index + 1,
        currentModel: detectedModels[index + 1]?.upstreamModelName ?? null,
        error: null
      });
    }

    updateDetectionProgress(requestId, {
      status: "completed",
      total: saved.length,
      completed: saved.length,
      currentModel: null,
      error: null
    });

    return {
      requestId,
      accountId: account.id,
      channelId: channel.id,
      listError: trimError(listError),
      capabilities: saved,
      account: sanitizeAccount(account),
      channel,
      platformId: inferPlatformIdFromChannel(channel),
      discovery: {
        mode: discoveryMode,
        listSupported: Boolean(adapter.listModels),
        upstreamListCount,
        candidateProbeCount,
        verifiedByTest: Boolean(adapter.testModel)
      },
      warnings,
      summary: {
        total: saved.length,
        available: saved.filter((model) => model.status === "available").length,
        unavailable: saved.filter((model) => model.status === "unavailable").length,
        unknown: saved.filter((model) => model.status === "unknown").length,
        durationMs: Date.now() - startedAt
      },
      models: saved
    };
  } catch (error) {
    updateDetectionProgress(requestId, {
      status: "failed",
      currentModel: null,
      error: trimError(toSafeErrorMessage(error))
    });
    throw error;
  }
}

export async function testAccountModels(accountId: string, input: unknown) {
  const startedAt = Date.now();
  const requestId = requestIdFromInput(input) ?? createId("detect");
  const selectedModels = selectedModelsFromInput(input);
  updateDetectionProgress(requestId, {
    accountId,
    status: "testing",
    total: selectedModels.length,
    completed: 0,
    currentModel: selectedModels[0]?.upstreamModelName ?? null,
    error: null
  });

  try {
    const account = await getRawAccount(accountId);
    const channel = await getAccountChannel(account);
    const adapter = adapterRegistry.get(channel.adapterType);
    if (!adapter) {
      throw new GatewayError("ADAPTER_NOT_FOUND", "Adapter was not found for account channel", 500);
    }

    const warnings = ["Selected models were tested with real requests."];
    const saved: AccountModelCapabilityRecord[] = [];
    for (const [index, model] of selectedModels.entries()) {
      updateDetectionProgress(requestId, {
        accountId: account.id,
        channelId: channel.id,
        status: "testing",
        total: selectedModels.length,
        completed: index,
        currentModel: model.upstreamModelName,
        error: null
      });
      const test = adapter.testModel
        ? await adapter.testModel(account, channel, model.upstreamModelName, { requestId })
        : {
            status: "unknown" as const,
            error: "Adapter does not support model ping tests"
          };
      const source = normalizedSource(model.source);
      const capability = await upsertCapability(account, model, test, source, Boolean(adapter.testModel), warnings);
      saved.push(capability);
      await ensureLegacyModel(capability);
      updateDetectionProgress(requestId, {
        status: "testing",
        total: selectedModels.length,
        completed: index + 1,
        currentModel: selectedModels[index + 1]?.upstreamModelName ?? null,
        error: null
      });
    }

    updateDetectionProgress(requestId, {
      status: "completed",
      total: saved.length,
      completed: saved.length,
      currentModel: null,
      error: null
    });

    const upstreamListCount = selectedModels.filter((model) => normalizedSource(model.source) === "upstream_list").length;
    return {
      requestId,
      accountId: account.id,
      channelId: channel.id,
      listError: null,
      capabilities: saved,
      account: sanitizeAccount(account),
      channel,
      platformId: inferPlatformIdFromChannel(channel),
      discovery: {
        mode: upstreamListCount === saved.length ? ("upstream_list" as DetectionMode) : ("mixed" as DetectionMode),
        listSupported: Boolean(adapter.listModels),
        upstreamListCount,
        candidateProbeCount: 0,
        verifiedByTest: Boolean(adapter.testModel)
      },
      warnings,
      summary: {
        total: saved.length,
        available: saved.filter((model) => model.status === "available").length,
        unavailable: saved.filter((model) => model.status === "unavailable").length,
        unknown: saved.filter((model) => model.status === "unknown").length,
        durationMs: Date.now() - startedAt
      },
      models: saved
    };
  } catch (error) {
    updateDetectionProgress(requestId, {
      status: "failed",
      currentModel: null,
      error: trimError(toSafeErrorMessage(error))
    });
    throw error;
  }
}

export async function createAccountModelCapability(accountId: string, input: unknown) {
  const account = await getRawAccount(accountId);
  const body = bodyObject(input);
  const upstreamModelName = stringValue(body, "upstreamModelName", "upstream_model_name");
  const now = nowIso();
  const record: NewAccountModelCapabilityRecord = {
    id: createId("amc"),
    accountId: account.id,
    channelId: account.channelId,
    upstreamModelName,
    displayName: optionalString(body, "displayName", "display_name") ?? upstreamModelName,
    status: statusValue(body.status),
    capabilities: jsonValue(body, "capabilities", "capabilities", {}),
    lastCheckedAt: optionalString(body, "lastCheckedAt", "last_checked_at") ?? null,
    lastSuccessAt: optionalString(body, "lastSuccessAt", "last_success_at") ?? null,
    lastError: trimError(optionalString(body, "lastError", "last_error")),
    latencyMs: optionalNumber(body, "latencyMs", "latency_ms") ?? null,
    source: normalizedSource(stringValue(body, "source", "source", "manual")),
    verifiedByTest: booleanValue(body, "verifiedByTest", "verified_by_test", false),
    discoveryMode: normalizedSource(stringValue(body, "discoveryMode", "discovery_mode", "manual")),
    discoverySource: optionalString(body, "discoverySource", "discovery_source") ?? null,
    warnings: jsonValue(body, "warnings", "warnings", []),
    raw: jsonValue(body, "raw", "raw", {}),
    createdAt: now,
    updatedAt: now
  };
  await db.insert(accountModelCapabilities).values(record);
  return getCapability(record.id);
}

export async function updateAccountModelCapability(id: string, input: unknown) {
  await getCapability(id);
  const body = bodyObject(input);
  const patch: Partial<NewAccountModelCapabilityRecord> = { updatedAt: nowIso() };
  if (body.upstreamModelName !== undefined || body.upstream_model_name !== undefined) {
    patch.upstreamModelName = stringValue(body, "upstreamModelName", "upstream_model_name");
  }
  if (body.displayName !== undefined || body.display_name !== undefined) {
    patch.displayName = optionalString(body, "displayName", "display_name") ?? null;
  }
  if (body.status !== undefined) {
    patch.status = statusValue(body.status);
  }
  if (body.capabilities !== undefined) {
    patch.capabilities = optionalJsonValue(body, "capabilities");
  }
  if (body.lastCheckedAt !== undefined || body.last_checked_at !== undefined) {
    patch.lastCheckedAt = optionalString(body, "lastCheckedAt", "last_checked_at") ?? null;
  }
  if (body.lastSuccessAt !== undefined || body.last_success_at !== undefined) {
    patch.lastSuccessAt = optionalString(body, "lastSuccessAt", "last_success_at") ?? null;
  }
  if (body.lastError !== undefined || body.last_error !== undefined) {
    patch.lastError = trimError(optionalString(body, "lastError", "last_error"));
  }
  if (body.latencyMs !== undefined || body.latency_ms !== undefined) {
    patch.latencyMs = optionalNumber(body, "latencyMs", "latency_ms") ?? null;
  }
  if (body.source !== undefined) {
    patch.source = normalizedSource(stringValue(body, "source"));
  }
  if (body.verifiedByTest !== undefined || body.verified_by_test !== undefined) {
    patch.verifiedByTest = booleanValue(body, "verifiedByTest", "verified_by_test", false);
  }
  if (body.discoveryMode !== undefined || body.discovery_mode !== undefined) {
    patch.discoveryMode = normalizedSource(stringValue(body, "discoveryMode", "discovery_mode"));
  }
  if (body.discoverySource !== undefined || body.discovery_source !== undefined) {
    patch.discoverySource = optionalString(body, "discoverySource", "discovery_source") ?? null;
  }
  if (body.warnings !== undefined) {
    patch.warnings = jsonValue(body, "warnings", "warnings", []);
  }
  if (body.raw !== undefined) {
    patch.raw = jsonValue(body, "raw", "raw", {});
  }
  await db.update(accountModelCapabilities).set(patch).where(eq(accountModelCapabilities.id, id));
  return getCapability(id);
}

export async function deleteAccountModelCapability(id: string) {
  await getCapability(id);
  await db.delete(accountModelCapabilities).where(eq(accountModelCapabilities.id, id));
  return { ok: true };
}

export async function createModelRouteFromCapability(id: string, input: unknown) {
  const capability = await getCapability(id);
  if (capability.status !== "available") {
    throw new GatewayError("VALIDATION_ERROR", "Only available model capabilities can create model routes", 400);
  }
  const body = input === undefined || input === null ? {} : bodyObject(input);
  const publicName =
    optionalString(body, "publicName", "public_name") ?? capability.upstreamModelName;
  const displayName =
    optionalString(body, "displayName", "display_name") ?? capability.displayName ?? capability.upstreamModelName;

  let model = await db.select().from(models).where(eq(models.publicName, publicName)).get();
  let modelCreated = false;
  if (!model) {
    const record: NewModelRecord = {
      id: createId("mdl"),
      publicName,
      displayName,
      description: optionalString(body, "description") ?? null,
      capabilities: capability.capabilities,
      status: "enabled"
    };
    await db.insert(models).values(record);
    model = await db.select().from(models).where(eq(models.id, record.id)).get();
    modelCreated = true;
  }
  if (!model) {
    throw new GatewayError("UPSTREAM_ERROR", "Failed to create public model", 500);
  }

  let route = await db
    .select()
    .from(modelRoutes)
    .where(
      and(
        eq(modelRoutes.modelId, model.id),
        eq(modelRoutes.channelId, capability.channelId),
        eq(modelRoutes.upstreamModelName, capability.upstreamModelName)
      )
    )
    .get();
  let routeCreated = false;
  if (!route) {
    const routeRecord: NewModelRouteRecord = {
      id: createId("mrt"),
      modelId: model.id,
      channelId: capability.channelId,
      upstreamModelName: capability.upstreamModelName,
      priority: numberValue(body, "priority", "priority", 100),
      weight: numberValue(body, "weight", "weight", 1),
      enabled: booleanValue(body, "enabled", "enabled", true),
      fallbackOrder: numberValue(body, "fallbackOrder", "fallback_order", 0)
    };
    await db.insert(modelRoutes).values(routeRecord);
    route = await db.select().from(modelRoutes).where(eq(modelRoutes.id, routeRecord.id)).get();
    routeCreated = true;
  }
  if (!route) {
    throw new GatewayError("UPSTREAM_ERROR", "Failed to create model route", 500);
  }

  return {
    model,
    route,
    created: {
      model: modelCreated,
      route: routeCreated
    }
  };
}
