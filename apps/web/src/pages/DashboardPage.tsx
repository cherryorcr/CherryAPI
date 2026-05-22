import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Activity, AlertCircle, CheckCircle2, Database, PowerOff, Server, ShieldCheck } from "lucide-react";
import { apiGet } from "../api/client";
import { ErrorBanner, PageHeader, Panel, StatusPill } from "../components/ui";
import type {
  AccountRecord,
  ApiKeyRecord,
  ChannelRecord,
  ChannelHealthRecord,
  DashboardStats,
  HealthResponse,
  ModelRecord,
  UsageLogRecord
} from "../types/admin";
import { formatDate, shortId } from "./helpers";

type StatTone = "blue" | "emerald" | "red" | "teal" | "amber" | "slate";

const statToneClasses: Record<StatTone, { bar: string; icon: string }> = {
  blue: {
    bar: "from-blue-500 to-cyan-500",
    icon: "bg-blue-50 text-blue-700 ring-blue-100"
  },
  emerald: {
    bar: "from-emerald-500 to-teal-500",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100"
  },
  red: {
    bar: "from-red-500 to-orange-500",
    icon: "bg-red-50 text-red-700 ring-red-100"
  },
  teal: {
    bar: "from-teal-500 to-sky-500",
    icon: "bg-teal-50 text-teal-700 ring-teal-100"
  },
  amber: {
    bar: "from-amber-500 to-orange-500",
    icon: "bg-amber-50 text-amber-700 ring-amber-100"
  },
  slate: {
    bar: "from-slate-400 to-slate-600",
    icon: "bg-slate-100 text-slate-700 ring-slate-200"
  }
};

export function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogRecord[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [channelHealth, setChannelHealth] = useState<ChannelHealthRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<HealthResponse>("/admin/health"),
      apiGet<DashboardStats>("/admin/dashboard/stats"),
      apiGet<ChannelHealthRecord[]>("/admin/dashboard/channel-health"),
      apiGet<ChannelRecord[]>("/admin/channels"),
      apiGet<AccountRecord[]>("/admin/accounts"),
      apiGet<ModelRecord[]>("/admin/models"),
      apiGet<ApiKeyRecord[]>("/admin/api-keys"),
      apiGet<UsageLogRecord[]>("/admin/usage-logs?limit=10")
    ]).then(([nextHealth, nextStats, nextChannelHealth, nextChannels, nextAccounts, nextModels, nextApiKeys, nextLogs]) => {
        setHealth(nextHealth);
        setStats(nextStats);
        setChannelHealth(nextChannelHealth);
        setChannels(nextChannels);
        setAccounts(nextAccounts);
        setModels(nextModels);
        setApiKeys(nextApiKeys);
        setUsageLogs(nextLogs);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const statCards = useMemo(
    () => [
      { label: "Total Requests", value: stats?.totalRequests ?? 0, icon: Activity, tone: "blue" },
      { label: "Success Requests", value: stats?.successRequests ?? 0, icon: CheckCircle2, tone: "emerald" },
      { label: "Failed Requests", value: stats?.failedRequests ?? 0, icon: AlertCircle, tone: "red" },
      { label: "Success Rate", value: `${Math.round((stats?.successRate ?? 1) * 100)}%`, icon: ShieldCheck, tone: "teal" },
      { label: "Total Tokens", value: stats?.totalTokens ?? 0, icon: Database, tone: "blue" },
      { label: "Enabled Accounts", value: stats?.enabledAccounts ?? 0, icon: Server, tone: "slate" },
      { label: "Healthy Accounts", value: stats?.healthyAccounts ?? 0, icon: CheckCircle2, tone: "emerald" },
      { label: "Degraded Accounts", value: stats?.degradedAccounts ?? 0, icon: AlertCircle, tone: "amber" },
      { label: "Disabled Accounts", value: stats?.disabledAccounts ?? 0, icon: PowerOff, tone: "red" }
    ] satisfies Array<{ icon: ComponentType<{ size?: number }>; label: string; tone: StatTone; value: number | string }>,
    [stats]
  );

  const recentErrors = usageLogs.filter((log) => log.status !== "success").slice(0, 5);
  const totalAccounts = accounts.length;
  const successRate = Math.round((stats?.successRate ?? health?.successRate ?? 1) * 100);
  const healthState =
    error || successRate < 90 || (stats?.failedRequests ?? 0) > Math.max(3, (stats?.successRequests ?? 0) * 0.2)
      ? "attention"
      : (stats?.degradedAccounts ?? 0) > 0 || (stats?.disabledAccounts ?? 0) > 0
        ? "degraded"
        : "healthy";
  const healthText =
    healthState === "healthy" ? "healthy" : healthState === "degraded" ? "degraded" : "needs attention";
  const healthBar =
    healthState === "healthy"
      ? "bg-emerald-500"
      : healthState === "degraded"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <section className="space-y-6">
      <PageHeader description="Gateway health, inventory counts, and recent usage." title="Dashboard" />
      <ErrorBanner message={error} />

      <Panel title="Gateway Health">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Current State</div>
                <div className="mt-1 text-xl font-semibold text-slate-950">{healthText}</div>
              </div>
              <StatusPill value={healthText} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full ${healthBar}`} style={{ width: `${Math.max(8, successRate)}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-500">{successRate}% request success rate</div>
          </div>
          {[
            ["Adapters", health?.adapters.length ?? 0],
            ["Channels", channels.length],
            ["Accounts", totalAccounts],
            ["Models", models.length],
            ["API Keys", apiKeys.length]
          ].map(([label, value]) => (
            <div className="rounded-lg border border-slate-200 bg-white p-4" key={label}>
              <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Healthy accounts: {stats?.healthyAccounts ?? health?.counts.healthyAccounts ?? 0}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Degraded accounts: {stats?.degradedAccounts ?? 0}
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Recent failures: {stats?.failedRequests ?? recentErrors.length}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const tone = statToneClasses[stat.tone];
          return (
          <div
            key={stat.label}
            className="group overflow-hidden rounded-lg border border-slate-200/80 bg-white/80 p-4 shadow-sm shadow-slate-900/5 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:shadow-slate-900/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold uppercase text-slate-500">{stat.label}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</div>
              </div>
              <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${tone.icon}`}>
                <Icon size={20} />
              </div>
            </div>
            <div className={`mt-4 h-1 rounded-full bg-gradient-to-r ${tone.bar}`} />
          </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent Usage">
          <div className="divide-y divide-zinc-100">
            {usageLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
                <div>
                  <div className="font-medium text-zinc-800">{log.requestModel}</div>
                  <div className="text-xs text-zinc-500">
                    {shortId(log.requestId)} · {formatDate(log.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <StatusPill value={log.status} />
                  <div className="mt-1 text-xs text-zinc-500">{log.totalTokens} tokens</div>
                </div>
              </div>
            ))}
            {usageLogs.length === 0 && <div className="py-6 text-sm text-zinc-500">No usage logs yet.</div>}
          </div>
        </Panel>

        <Panel title="Recent Errors">
          <div className="divide-y divide-zinc-100">
            {recentErrors.map((log) => (
              <div key={log.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-zinc-800">{log.errorCode ?? "ERROR"}</span>
                  <span className="text-xs text-zinc-500">{formatDate(log.createdAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-zinc-500">{log.errorMessage}</p>
              </div>
            ))}
            {recentErrors.length === 0 && <div className="py-6 text-sm text-zinc-500">No recent errors.</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Channel Health Overview">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Healthy</th>
                <th className="px-3 py-2">Degraded</th>
                <th className="px-3 py-2">Disabled</th>
                <th className="px-3 py-2">Cooldown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {channelHealth.map((channel) => (
                <tr key={channel.channelId}>
                  <td className="px-3 py-2 font-medium text-zinc-800">{channel.channelName}</td>
                  <td className="px-3 py-2">{channel.totalAccounts}</td>
                  <td className="px-3 py-2 text-emerald-700">{channel.healthy}</td>
                  <td className="px-3 py-2 text-amber-700">{channel.degraded}</td>
                  <td className="px-3 py-2 text-red-700">{channel.disabled}</td>
                  <td className="px-3 py-2 text-zinc-500">{channel.cooldown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Adapters">
        <div className="divide-y divide-zinc-100">
          {(health?.adapters ?? []).map((adapter) => (
            <div key={adapter.type} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="font-medium text-zinc-800">{adapter.type}</span>
              <span className="text-zinc-500">
                chat {adapter.capabilities.chatCompletions ? "yes" : "no"} · stream{" "}
                {adapter.capabilities.streaming ? "yes" : "no"} · responses{" "}
                {adapter.capabilities.responses ? "yes" : "no"}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
