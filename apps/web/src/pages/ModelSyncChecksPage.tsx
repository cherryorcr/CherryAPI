import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Panel,
  RefreshButton,
  StatusPill,
  SuccessBanner,
  inputClass
} from "../components/ui";
import type {
  AccountModelCapabilityRecord,
  AccountModelDetectionResponse,
  AccountRecord,
  ChannelRecord
} from "../types/admin";
import { formatDate } from "./helpers";

export function ModelSyncChecksPage() {
  const [capabilities, setCapabilities] = useState<AccountModelCapabilityRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [channelFilter, setChannelFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [nextCapabilities, nextAccounts, nextChannels] = await Promise.all([
        apiGet<AccountModelCapabilityRecord[]>("/admin/account-model-capabilities"),
        apiGet<AccountRecord[]>("/admin/accounts"),
        apiGet<ChannelRecord[]>("/admin/channels")
      ]);
      setCapabilities(nextCapabilities);
      setAccounts(nextAccounts);
      setChannels(nextChannels);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredCapabilities = useMemo(
    () =>
      capabilities.filter((capability) => {
        if (channelFilter && capability.channelId !== channelFilter) return false;
        if (accountFilter && capability.accountId !== accountFilter) return false;
        if (statusFilter && capability.status !== statusFilter) return false;
        return true;
      }),
    [accountFilter, capabilities, channelFilter, statusFilter]
  );

  function accountName(id: string): string {
    return accounts.find((account) => account.id === id)?.name ?? id;
  }

  function channelName(id: string): string {
    return channels.find((channel) => channel.id === id)?.name ?? id;
  }

  function boolText(value: unknown): string {
    if (value === true) return "yes";
    if (value === false) return "no";
    if (value === "unknown") return "unknown";
    return "-";
  }

  function sourceText(source: string): string {
    if (source === "upstream_list" || source === "detected") return "Upstream list";
    if (source === "candidate_probe" || source === "candidate") return "Candidate probe";
    return source || "-";
  }

  async function detectAccount(accountId: string) {
    if (!accountId) {
      setError("Select an account to sync models.");
      return;
    }
    try {
      const response = await apiPost<AccountModelDetectionResponse>(`/admin/accounts/${accountId}/detect-models`, {});
      setSuccess(`Synced and tested ${response.capabilities.length} upstream models for ${accountName(accountId)}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex flex-wrap gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <Button disabled={!accountFilter || loading} onClick={() => void detectAccount(accountFilter)}>
              <Search size={16} />
              Sync & Test Models
            </Button>
          </div>
        }
        description="Sync upstream model lists, run real chat / stream / responses checks, and review account capabilities."
        title="Model Sync & Checks"
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Panel title="Filters">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Channel">
            <select className={inputClass} onChange={(e) => setChannelFilter(e.target.value)} value={channelFilter}>
              <option value="">All channels</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account">
            <select className={inputClass} onChange={(e) => setAccountFilter(e.target.value)} value={accountFilter}>
              <option value="">All accounts</option>
              {accounts
                .filter((account) => !channelFilter || account.channelId === channelFilter)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputClass} onChange={(e) => setStatusFilter(e.target.value)} value={statusFilter}>
              <option value="">All statuses</option>
              <option value="available">available</option>
              <option value="unavailable">unavailable</option>
              <option value="unknown">unknown</option>
            </select>
          </Field>
        </div>
      </Panel>

      <Panel>
        {filteredCapabilities.length === 0 ? (
          <EmptyState message="No detected models match the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Upstream Model</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Chat</th>
                  <th className="px-3 py-2">Stream</th>
                  <th className="px-3 py-2">Responses</th>
                  <th className="px-3 py-2">Last Checked</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredCapabilities.map((capability) => (
                  <tr key={capability.id}>
                    <td className="px-3 py-2">{channelName(capability.channelId)}</td>
                    <td className="px-3 py-2">{accountName(capability.accountId)}</td>
                    <td className="px-3 py-2 font-medium text-zinc-800">{capability.upstreamModelName}</td>
                    <td className="px-3 py-2 text-zinc-500">{sourceText(capability.source)}</td>
                    <td className="px-3 py-2"><StatusPill value={capability.status} /></td>
                    <td className="px-3 py-2 text-zinc-500">{boolText(capability.capabilities.chatCompletions)}</td>
                    <td className="px-3 py-2 text-zinc-500">{boolText(capability.capabilities.streaming)}</td>
                    <td className="px-3 py-2 text-zinc-500">{boolText(capability.capabilities.responses)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{formatDate(capability.lastCheckedAt)}</td>
                    <td className="px-3 py-2 text-zinc-500">{capability.latencyMs === null ? "-" : `${capability.latencyMs}ms`}</td>
                    <td className="max-w-sm truncate px-3 py-2 text-zinc-500">{capability.lastError ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}
