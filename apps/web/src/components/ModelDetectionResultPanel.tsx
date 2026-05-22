import type { PlatformDefinition } from "@cherryapi/shared";
import { AlertCircle, CheckCircle2, Clock3, Route } from "lucide-react";
import { PlatformLogo } from "./PlatformLogo";
import { Button, EmptyState, Panel, StatusPill } from "./ui";
import type {
  AccountModelCapabilityRecord,
  AccountModelDetectionResponse,
  AccountRecord,
  ChannelRecord
} from "../types/admin";

function boolText(value: unknown): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === "unknown") return "unknown";
  return "-";
}

function modelRows(result: AccountModelDetectionResponse): AccountModelCapabilityRecord[] {
  return result.models ?? result.capabilities ?? [];
}

function sourceText(source: string): string {
  if (source === "upstream_list" || source === "detected") return "Upstream list";
  if (source === "candidate_probe" || source === "candidate") return "Candidate probe";
  return source || "-";
}

export function ModelDetectionResultPanel({
  account,
  channel,
  platform,
  result,
  onGoToDiscovery
}: {
  account: AccountRecord;
  channel: ChannelRecord;
  platform?: PlatformDefinition;
  result: AccountModelDetectionResponse;
  onGoToDiscovery: () => void;
}) {
  const models = modelRows(result);
  const summary = result.summary ?? {
    total: models.length,
    available: models.filter((model) => model.status === "available").length,
    unavailable: models.filter((model) => model.status === "unavailable").length,
    unknown: models.filter((model) => model.status === "unknown").length,
    durationMs: 0
  };
  const successPercent = summary.total > 0 ? Math.round((summary.available / summary.total) * 100) : 0;

  return (
    <Panel title="Model Sync Results">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <PlatformLogo label={platform?.name} platformId={platform?.id ?? result.platformId} size="md" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900">{account.name}</div>
            <div className="text-xs text-zinc-500">
              {platform?.name ?? result.platformId ?? "Platform"} / {channel.name}
            </div>
          </div>
        </div>
        <Button onClick={onGoToDiscovery} variant="secondary">
          <Route size={16} />
          Go to Model Sync & Checks
        </Button>
      </div>

      <div className="mb-4 grid gap-2 text-sm sm:grid-cols-5">
        {[
          { label: "Total", value: summary.total, icon: Route, tone: "text-blue-700 bg-blue-50 border-blue-100" },
          { label: "Available", value: summary.available, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
          { label: "Unavailable", value: summary.unavailable, icon: AlertCircle, tone: "text-red-700 bg-red-50 border-red-100" },
          { label: "Unknown", value: summary.unknown, icon: AlertCircle, tone: "text-amber-700 bg-amber-50 border-amber-100" },
          { label: "Duration", value: `${summary.durationMs}ms`, icon: Clock3, tone: "text-slate-700 bg-slate-50 border-slate-200" }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div className={`rounded-lg border px-3 py-2 ${item.tone}`} key={item.label}>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase">
                <Icon size={14} />
                {item.label}
              </div>
              <div className="mt-1 text-lg font-semibold">{item.value}</div>
            </div>
          );
        })}
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>Available model coverage</span>
          <span>{successPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${successPercent}%` }} />
        </div>
      </div>

      {result.discovery && (
        <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          Source: <span className="font-medium">{sourceText(result.discovery.mode)}</span> / model list{" "}
          {result.discovery.listSupported ? "supported" : "not supported"} / synced {result.discovery.upstreamListCount} / verification{" "}
          {result.discovery.verifiedByTest ? "chat + stream + responses requests" : "not supported"}
        </div>
      )}

      {result.warnings?.map((warning) => (
        <div key={warning} className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {warning}
        </div>
      ))}

      {result.listError && !result.warnings?.length && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{result.listError}</div>
      )}

      {models.length === 0 ? (
        <EmptyState message="No model detection rows were returned." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Upstream Model</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Chat</th>
                <th className="px-3 py-2">Stream</th>
                <th className="px-3 py-2">Responses</th>
                <th className="px-3 py-2">Tools</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Last Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {models.map((model) => (
                <tr key={model.id}>
                  <td className="px-3 py-2 font-medium text-zinc-800">{model.upstreamModelName}</td>
                  <td className="px-3 py-2 text-zinc-500">{sourceText(model.source)}</td>
                  <td className="px-3 py-2">
                    <StatusPill value={model.status} />
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{boolText(model.capabilities.chatCompletions)}</td>
                  <td className="px-3 py-2 text-zinc-500">{boolText(model.capabilities.streaming)}</td>
                  <td className="px-3 py-2 text-zinc-500">{boolText(model.capabilities.responses)}</td>
                  <td className="px-3 py-2 text-zinc-500">{boolText(model.capabilities.tools)}</td>
                  <td className="px-3 py-2 text-zinc-500">{model.latencyMs === null ? "-" : `${model.latencyMs}ms`}</td>
                  <td className="max-w-sm truncate px-3 py-2 text-zinc-500">{model.lastError ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
