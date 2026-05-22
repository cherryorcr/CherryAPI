import { useEffect, useState } from "react";
import { apiGet } from "../api/client";
import {
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Panel,
  RefreshButton,
  StatusPill,
  inputClass
} from "../components/ui";
import type { UsageLogRecord } from "../types/admin";
import { formatDate, shortId } from "./helpers";

function EntityCell({ id, name }: { id: string | null; name: string | null }) {
  if (!id && !name) {
    return <span className="text-zinc-400">-</span>;
  }

  return (
    <div className="min-w-36 max-w-48">
      <div className="truncate font-medium text-zinc-800" title={name ?? id ?? undefined}>
        {name ?? shortId(id)}
      </div>
      {id ? (
        <div className="truncate text-xs text-zinc-500" title={id}>
          {shortId(id)}
        </div>
      ) : null}
    </div>
  );
}

export function UsageLogsPage() {
  const [logs, setLogs] = useState<UsageLogRecord[]>([]);
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [channel, setChannel] = useState("");
  const [account, setAccount] = useState("");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status) params.set("status", status);
      if (model) params.set("model", model);
      if (channel) params.set("channel", channel);
      if (account) params.set("account", account);
      if (keyword) params.set("keyword", keyword);
      const query = `?${params.toString()}`;
      setLogs(await apiGet<UsageLogRecord[]>(`/admin/usage-logs${query}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <section className="space-y-6">
      <PageHeader
        action={<RefreshButton disabled={loading} onClick={load} />}
        description="Inspect gateway calls, token usage, latency, and errors."
        title="Usage Logs"
      />
      <ErrorBanner message={error} />

      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <Field label="Status">
            <select className={inputClass} onChange={(e) => setStatus(e.target.value)} value={status}>
              <option value="">all</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
              <option value="error">error legacy</option>
            </select>
          </Field>
          <Field label="Model">
            <input className={inputClass} onChange={(e) => setModel(e.target.value)} value={model} />
          </Field>
          <Field label="Channel">
            <input
              className={inputClass}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="name or id"
              value={channel}
            />
          </Field>
          <Field label="Account">
            <input
              className={inputClass}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="name or id"
              value={account}
            />
          </Field>
          <Field label="Error Keyword">
            <input
              className={inputClass}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              value={keyword}
            />
          </Field>
          <div className="md:col-span-5">
            <RefreshButton disabled={loading} onClick={load} />
          </div>
        </div>

        {logs.length === 0 ? (
          <EmptyState message="No usage logs yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Prompt</th>
                  <th className="px-3 py-2">Completion</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Error Code</th>
                  <th className="px-3 py-2">Error Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{formatDate(log.createdAt)}</td>
                    <td className="px-3 py-2"><StatusPill value={log.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-800">{log.requestModel}</div>
                      <div className="text-xs text-zinc-500">{log.upstreamModel ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2"><EntityCell id={log.channelId} name={log.channelName} /></td>
                    <td className="px-3 py-2"><EntityCell id={log.accountId} name={log.accountName} /></td>
                    <td className="px-3 py-2">{log.totalTokens}</td>
                    <td className="px-3 py-2">{log.promptTokens}</td>
                    <td className="px-3 py-2">{log.completionTokens}</td>
                    <td className="px-3 py-2">{log.latencyMs} ms</td>
                    <td className="px-3 py-2 text-zinc-500">{log.errorCode ?? "-"}</td>
                    <td className="max-w-sm truncate px-3 py-2 text-zinc-500">{log.errorMessage ?? "-"}</td>
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
