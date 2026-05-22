import { useEffect, useState } from "react";
import { Network, Save, SearchCheck } from "lucide-react";
import { apiGet, apiPost, apiPut } from "../api/client";
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
import type { GlobalProxyConfig, ProxyDetectionResponse, ProxyDetectionResult } from "../types/admin";
import { formatDate } from "./helpers";

const commonCandidates = [
  "http://127.0.0.1:7890",
  "http://127.0.0.1:7897",
  "http://127.0.0.1:7898",
  "http://127.0.0.1:7899",
  "http://127.0.0.1:10808",
  "http://host.docker.internal:7890",
  "http://host.docker.internal:7897",
  "http://host.docker.internal:10808"
].join("\n");

function emptyConfig(): GlobalProxyConfig {
  return {
    enabled: false,
    proxyUrl: "",
    source: "disabled",
    lastCheckedAt: null,
    lastStatus: "unknown",
    lastError: null
  };
}

function resultStatus(result: ProxyDetectionResult): string {
  if (result.ok) return "available";
  if (result.error?.includes("unsupported country")) return "region blocked";
  return "unavailable";
}

export function ProxyPage() {
  const [config, setConfig] = useState<GlobalProxyConfig>(emptyConfig());
  const [proxyUrl, setProxyUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [candidateText, setCandidateText] = useState(commonCandidates);
  const [detection, setDetection] = useState<ProxyDetectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const next = await apiGet<GlobalProxyConfig>("/admin/proxy/config");
      setConfig(next);
      setProxyUrl(next.proxyUrl ?? "");
      setEnabled(next.enabled);
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

  async function save() {
    setSaving(true);
    try {
      const next = await apiPut<GlobalProxyConfig>("/admin/proxy/config", {
        enabled,
        proxy_url: proxyUrl
      });
      setConfig(next);
      setSuccess(enabled ? `Global proxy set to ${next.proxyUrl}` : "Global proxy disabled");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function detectAndApply() {
    setLoading(true);
    try {
      const response = await apiPost<ProxyDetectionResponse>("/admin/proxy/detect", {
        apply: true,
        include_direct: true,
        candidates: candidateText
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        timeout_ms: 8000
      });
      setDetection(response);
      setConfig(response.active);
      setProxyUrl(response.active.proxyUrl ?? "");
      setEnabled(response.active.enabled);
      setSuccess(response.applied ? `Switched global proxy to ${response.active.proxyUrl}` : "No usable proxy candidate was detected");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <Button disabled={loading} onClick={() => void detectAndApply()}>
              <SearchCheck size={16} />
              Detect & Switch
            </Button>
          </div>
        }
        description="Configure the global outbound proxy used by OAuth login, model detection, and upstream API calls. Account-level proxy still has priority."
        title="Proxy"
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Panel title="Global Proxy">
          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Status</span>
                <StatusPill value={config.enabled ? config.lastStatus : "disabled"} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Active</span>
                <span className="truncate font-medium text-zinc-800">{config.enabled ? config.proxyUrl : "direct"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Source</span>
                <span className="text-zinc-800">{config.source}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Last Checked</span>
                <span className="text-zinc-800">{formatDate(config.lastCheckedAt)}</span>
              </div>
              {config.lastError && <div className="text-xs text-amber-700">{config.lastError}</div>}
            </div>

            <Field label="Enabled">
              <label className="flex h-9 items-center gap-2 text-sm text-zinc-700">
                <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
                Use global proxy
              </label>
            </Field>
            <Field label="Proxy URL">
              <input
                className={inputClass}
                onChange={(event) => setProxyUrl(event.target.value)}
                placeholder="http://127.0.0.1:7890"
                value={proxyUrl}
              />
            </Field>
            <Button disabled={saving} onClick={() => void save()}>
              <Save size={16} />
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Detection">
          <div className="space-y-4">
            <Field label="Candidate Proxy URLs">
              <textarea
                className="min-h-32 rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 outline-none focus:border-zinc-500"
                onChange={(event) => setCandidateText(event.target.value)}
                value={candidateText}
              />
            </Field>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              <Network className="mr-1 inline" size={14} />
              Detection posts an intentionally invalid OAuth code to OpenAI auth through each candidate. A normal invalid-code response means the route is usable; an unsupported-country response is rejected.
            </div>

            {!detection ? (
              <EmptyState message="Run Detect & Switch to test direct access and common Clash ports." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Route</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">HTTP</th>
                      <th className="px-3 py-2">Latency</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {detection.results.map((result) => (
                      <tr key={result.proxyUrl ?? "direct"}>
                        <td className="max-w-xs truncate px-3 py-2 font-medium text-zinc-800">{result.label}</td>
                        <td className="px-3 py-2">
                          <StatusPill value={resultStatus(result)} />
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{result.status ?? "-"}</td>
                        <td className="px-3 py-2 text-zinc-500">{result.latencyMs}ms</td>
                        <td className="max-w-md truncate px-3 py-2 text-zinc-500">{result.error ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}
