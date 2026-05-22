import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import {
  Button,
  ErrorBanner,
  Field,
  PageHeader,
  Panel,
  StatusPill,
  inputClass,
  textareaClass
} from "../components/ui";
import type { AdminTestResponse, ApiKeyRecord, GroupModelBindingRecord } from "../types/admin";

export function TestConsolePage() {
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [apiKeyId, setApiKeyId] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("Hello, test CherryAPI.");
  const [result, setResult] = useState<AdminTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    apiGet<ApiKeyRecord[]>("/admin/api-keys")
      .then((nextKeys) => {
        setApiKeys(nextKeys);
        setApiKeyId(nextKeys.find((key) => key.status === "enabled")?.id ?? nextKeys[0]?.id ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selectedKey = useMemo(() => apiKeys.find((key) => key.id === apiKeyId), [apiKeyId, apiKeys]);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModel("");
    if (!selectedKey) {
      return;
    }

    setLoadingModels(true);
    apiGet<GroupModelBindingRecord[]>(`/admin/groups/${selectedKey.groupId}/model-bindings`)
      .then((bindings) => {
        if (cancelled) return;
        const publicModels = [
          ...new Set(
            bindings
              .filter((binding) => binding.enabled)
              .map((binding) => binding.publicModel)
              .filter(Boolean)
          )
        ].sort((left, right) => left.localeCompare(right));
        setModels(publicModels);
        setModel((current) => (publicModels.includes(current) ? current : publicModels[0] ?? ""));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  async function sendTest() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiPost<AdminTestResponse>("/admin/test/chat-completion", {
        api_key_id: apiKeyId,
        model,
        prompt
      });
      setResult(response);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader
        description="Run a non-streaming chat completion through CherryAPI using an existing API key."
        title="Test Console"
      />
      <ErrorBanner message={error} />

      <Panel title="Send Test">
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendTest();
          }}
        >
          <Field label="API Key">
            <select className={inputClass} onChange={(e) => setApiKeyId(e.target.value)} value={apiKeyId}>
              <option value="">Select API key</option>
              {apiKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name} - {key.keyPrefix}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <select className={inputClass} disabled={loadingModels || models.length === 0} onChange={(e) => setModel(e.target.value)} value={model}>
              <option value="">{loadingModels ? "Loading group models..." : "Select model"}</option>
              {models.map((publicModel) => (
                <option key={publicModel} value={publicModel}>
                  {publicModel}
                </option>
              ))}
            </select>
          </Field>
          {selectedKey && !loadingModels && models.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 md:col-span-2">
              This API key's group has no enabled model bindings. Open Groups, select the group, then save Model Bindings for the public models you want to expose.
            </div>
          )}
          <Field label="Prompt" span={2}>
            <textarea className={textareaClass} onChange={(e) => setPrompt(e.target.value)} value={prompt} />
          </Field>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button disabled={loading || !apiKeyId || !model || !prompt.trim()} type="submit">
              Send Test
            </Button>
            {selectedKey && <StatusPill value={selectedKey.status} />}
          </div>
        </form>
      </Panel>

      {result && (
        <Panel title="Result">
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase text-zinc-500">Model</div>
                <div className="font-medium">{result.model}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Latency</div>
                <div className="font-medium">{result.latencyMs} ms</div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Request ID</div>
                <div className="font-mono text-xs">{result.requestId}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Usage</div>
                <div className="font-medium">
                  {result.usage?.total_tokens ?? 0} total / {result.usage?.prompt_tokens ?? 0} prompt /{" "}
                  {result.usage?.completion_tokens ?? 0} completion
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-zinc-500">Response Content</div>
              <div className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3">{result.content || "(empty)"}</div>
            </div>
            <Button onClick={() => setResult(null)} variant="secondary">
              Clear Result
            </Button>
          </div>
        </Panel>
      )}
    </section>
  );
}
