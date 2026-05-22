import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
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
  inputClass,
  textareaClass
} from "../components/ui";
import type { ModelRecord } from "../types/admin";
import { asJsonText, parseJson, toNullableString } from "./helpers";

interface ModelFormState {
  id?: string;
  publicName: string;
  displayName: string;
  description: string;
  capabilities: string;
  status: string;
}

const emptyModel: ModelFormState = {
  publicName: "",
  displayName: "",
  description: "",
  capabilities: asJsonText({ chatCompletions: true, streaming: true, tools: true, responses: false }),
  status: "enabled"
};

function fromModel(model: ModelRecord): ModelFormState {
  return {
    id: model.id,
    publicName: model.publicName,
    displayName: model.displayName,
    description: model.description ?? "",
    capabilities: asJsonText(model.capabilities),
    status: model.status
  };
}

export function ModelsPage() {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [form, setForm] = useState<ModelFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setModels(await apiGet<ModelRecord[]>("/admin/models"));
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
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        public_name: form.publicName,
        display_name: form.displayName,
        description: toNullableString(form.description),
        capabilities: parseJson(form.capabilities, "capabilities"),
        status: form.status
      };
      if (form.id) {
        await apiPatch<ModelRecord>(`/admin/models/${form.id}`, payload);
      } else {
        await apiPost<ModelRecord>("/admin/models", payload);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(model: ModelRecord) {
    if (!window.confirm(`Delete model ${model.publicName}?`)) return;
    await apiDelete(`/admin/models/${model.id}`);
    await load();
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New Model" onClick={() => setForm(emptyModel)} />
          </div>
        }
        description="Advanced compatibility layer for legacy public model records. New API key routing is configured in Groups."
        title="Models"
      />
      <ErrorBanner message={error} />

      {form && (
        <Panel title={form.id ? "Edit Model" : "New Model"}>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Public Name">
              <input className={inputClass} onChange={(e) => setForm({ ...form, publicName: e.target.value })} value={form.publicName} />
            </Field>
            <Field label="Display Name">
              <input className={inputClass} onChange={(e) => setForm({ ...form, displayName: e.target.value })} value={form.displayName} />
            </Field>
            <Field label="Status">
              <select className={inputClass} onChange={(e) => setForm({ ...form, status: e.target.value })} value={form.status}>
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
            <Field label="Description" span={2}>
              <input className={inputClass} onChange={(e) => setForm({ ...form, description: e.target.value })} value={form.description} />
            </Field>
            <Field label="Capabilities JSON" span={2}>
              <textarea className={textareaClass} onChange={(e) => setForm({ ...form, capabilities: e.target.value })} value={form.capabilities} />
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
        {models.length === 0 ? (
          <EmptyState message="No models yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Public Name</th>
                  <th className="px-3 py-2">Display Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {models.map((model) => (
                  <tr key={model.id}>
                    <td className="px-3 py-2 font-medium text-zinc-800">{model.publicName}</td>
                    <td className="px-3 py-2">{model.displayName}</td>
                    <td className="px-3 py-2"><StatusPill value={model.status} /></td>
                    <td className="max-w-md truncate px-3 py-2 text-zinc-500">{model.description ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => setForm(fromModel(model))}>
                          <Pencil size={16} />
                        </IconButton>
                        <DeleteIconButton onClick={() => void remove(model)} />
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
