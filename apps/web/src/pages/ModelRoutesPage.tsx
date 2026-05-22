import { useEffect, useState } from "react";
import { CheckCircle2, Layers3, Network, Pencil, Route } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import {
  AddButton,
  Button,
  DeleteIconButton,
  EmptyState,
  ErrorBanner,
  Field,
  IconButton,
  PageHeader,
  Panel,
  RefreshButton,
  SaveButton,
  StatusPill,
  inputClass
} from "../components/ui";
import type { ChannelRecord, ModelRecord, ModelRouteRecord } from "../types/admin";
import { toNumber } from "./helpers";

interface RouteFormState {
  id?: string;
  modelId: string;
  channelId: string;
  upstreamModelName: string;
  priority: string;
  weight: string;
  enabled: boolean;
  fallbackOrder: string;
}

const emptyRoute: RouteFormState = {
  modelId: "",
  channelId: "",
  upstreamModelName: "",
  priority: "100",
  weight: "1",
  enabled: true,
  fallbackOrder: "0"
};

function fromRoute(route: ModelRouteRecord): RouteFormState {
  return {
    id: route.id,
    modelId: route.modelId,
    channelId: route.channelId,
    upstreamModelName: route.upstreamModelName,
    priority: String(route.priority),
    weight: String(route.weight),
    enabled: route.enabled,
    fallbackOrder: String(route.fallbackOrder)
  };
}

export function ModelRoutesPage() {
  const [routes, setRoutes] = useState<ModelRouteRecord[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [form, setForm] = useState<RouteFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [nextRoutes, nextModels, nextChannels] = await Promise.all([
        apiGet<ModelRouteRecord[]>("/admin/model-routes"),
        apiGet<ModelRecord[]>("/admin/models"),
        apiGet<ChannelRecord[]>("/admin/channels")
      ]);
      setRoutes(nextRoutes);
      setModels(nextModels);
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

  function modelName(id: string): string {
    return models.find((model) => model.id === id)?.publicName ?? id;
  }

  function channelName(id: string): string {
    return channels.find((channel) => channel.id === id)?.name ?? id;
  }

  function newForm() {
    setForm({
      ...emptyRoute,
      modelId: models[0]?.id ?? "",
      channelId: channels[0]?.id ?? ""
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        model_id: form.modelId,
        channel_id: form.channelId,
        upstream_model_name: form.upstreamModelName,
        priority: toNumber(form.priority, "priority", 100),
        weight: toNumber(form.weight, "weight", 1),
        enabled: form.enabled,
        fallback_order: toNumber(form.fallbackOrder, "fallback_order", 0)
      };
      if (form.id) {
        await apiPatch<ModelRouteRecord>(`/admin/model-routes/${form.id}`, payload);
      } else {
        await apiPost<ModelRouteRecord>("/admin/model-routes", payload);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(route: ModelRouteRecord) {
    if (!window.confirm(`Delete route for ${modelName(route.modelId)}?`)) return;
    await apiDelete(`/admin/model-routes/${route.id}`);
    await load();
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New Route" onClick={newForm} />
          </div>
        }
        description="Advanced compatibility layer for legacy model routes. Group model bindings are the primary routing path."
        title="Model Routes"
      />
      <ErrorBanner message={error} />

      <Panel title="Route Binding Flow">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Public model exists", value: `${models.length} models`, ready: models.length > 0, icon: Layers3 },
            { label: "Channel exists", value: `${channels.length} channels`, ready: channels.length > 0, icon: Network },
            { label: "Route bound", value: `${routes.length} routes`, ready: routes.length > 0, icon: Route }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                className={`rounded-lg border px-3 py-2 ${
                  item.ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
                key={item.label}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="shrink-0" size={16} />
                    <span className="truncate text-sm font-semibold">{item.label}</span>
                  </div>
                  {item.ready && <CheckCircle2 size={16} />}
                </div>
                <div className="mt-1 text-xs opacity-80">{item.value}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Recommended path: detect upstream models in Accounts, then expose public models through Groups. This legacy page is useful when you need a direct public-model-to-channel mapping.
        </div>
      </Panel>

      {form && (
        <Panel title={form.id ? "Edit Route" : "New Route"}>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Model">
              <select className={inputClass} onChange={(e) => setForm({ ...form, modelId: e.target.value })} value={form.modelId}>
                <option value="">Select model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.publicName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Channel">
              <select className={inputClass} onChange={(e) => setForm({ ...form, channelId: e.target.value })} value={form.channelId}>
                <option value="">Select channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Upstream Model Name" span={2}>
              <input className={inputClass} onChange={(e) => setForm({ ...form, upstreamModelName: e.target.value })} value={form.upstreamModelName} />
            </Field>
            <Field label="Priority">
              <input className={inputClass} onChange={(e) => setForm({ ...form, priority: e.target.value })} value={form.priority} />
            </Field>
            <Field label="Weight">
              <input className={inputClass} onChange={(e) => setForm({ ...form, weight: e.target.value })} value={form.weight} />
            </Field>
            <Field label="Fallback Order">
              <input className={inputClass} onChange={(e) => setForm({ ...form, fallbackOrder: e.target.value })} value={form.fallbackOrder} />
            </Field>
            <Field label="Enabled">
              <label className="flex h-9 items-center gap-2 text-sm text-zinc-700">
                <input checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} type="checkbox" />
                Enabled
              </label>
            </Field>
            <div className="flex gap-2 md:col-span-2">
              <SaveButton disabled={saving} />
              <Button onClick={() => setForm(null)} variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel>
        {routes.length === 0 ? (
          <EmptyState message="No model routes yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Upstream</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2">Enabled</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {routes.map((route) => (
                  <tr key={route.id}>
                    <td className="px-3 py-2 font-medium text-zinc-800">{modelName(route.modelId)}</td>
                    <td className="px-3 py-2">{channelName(route.channelId)}</td>
                    <td className="px-3 py-2 text-zinc-500">{route.upstreamModelName}</td>
                    <td className="px-3 py-2">{route.priority}</td>
                    <td className="px-3 py-2">{route.weight}</td>
                    <td className="px-3 py-2"><StatusPill value={route.enabled} /></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => setForm(fromRoute(route))}>
                          <Pencil size={16} />
                        </IconButton>
                        <DeleteIconButton onClick={() => void remove(route)} />
                      </div>
                    </td>
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
