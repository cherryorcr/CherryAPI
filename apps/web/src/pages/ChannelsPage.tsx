import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { PlatformLogo } from "../components/PlatformLogo";
import {
  AddButton,
  Button,
  CloseIconButton,
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
import type { ChannelRecord } from "../types/admin";
import { asJsonText, parseJson, toNumber, toNullableString } from "./helpers";
import { channelPlatformId } from "./accounts/helpers";

interface ChannelFormState {
  id?: string;
  name: string;
  provider: string;
  adapterType: string;
  protocol: string;
  baseUrl: string;
  status: string;
  priority: string;
  weight: string;
  capabilities: string;
  config: string;
}

const emptyChannel: ChannelFormState = {
  name: "",
  provider: "openai_compatible",
  adapterType: "openai_compatible",
  protocol: "openai_chat_completions",
  baseUrl: "",
  status: "enabled",
  priority: "100",
  weight: "1",
  capabilities: asJsonText({ chatCompletions: true, streaming: true, tools: true, responses: false }),
  config: "{}"
};

function fromChannel(channel: ChannelRecord): ChannelFormState {
  return {
    id: channel.id,
    name: channel.name,
    provider: channel.provider,
    adapterType: channel.adapterType,
    protocol: channel.protocol,
    baseUrl: channel.baseUrl ?? "",
    status: channel.status,
    priority: String(channel.priority),
    weight: String(channel.weight),
    capabilities: asJsonText(channel.capabilities),
    config: asJsonText(channel.config)
  };
}

export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setChannels(await apiGet<ChannelRecord[]>("/admin/channels"));
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
        name: form.name,
        provider: form.provider,
        adapter_type: form.adapterType,
        protocol: form.protocol,
        base_url: toNullableString(form.baseUrl),
        status: form.status,
        priority: toNumber(form.priority, "priority", 100),
        weight: toNumber(form.weight, "weight", 1),
        capabilities: parseJson(form.capabilities, "capabilities"),
        config: parseJson(form.config, "config")
      };
      if (form.id) {
        await apiPatch<ChannelRecord>(`/admin/channels/${form.id}`, payload);
      } else {
        await apiPost<ChannelRecord>("/admin/channels", payload);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(channel: ChannelRecord) {
    if (!window.confirm(`Delete channel ${channel.name}?`)) return;
    await apiDelete(`/admin/channels/${channel.id}`);
    await load();
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New Channel" onClick={() => setForm(emptyChannel)} />
          </div>
        }
        description="Manage upstream platforms and adapter settings."
        title="Channels"
      />
      <ErrorBanner message={error} />

      {form && (
        <Panel title={form.id ? "Edit Channel" : "New Channel"}>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Name">
              <input className={inputClass} onChange={(e) => setForm({ ...form, name: e.target.value })} value={form.name} />
            </Field>
            <Field label="Provider">
              <input className={inputClass} onChange={(e) => setForm({ ...form, provider: e.target.value })} value={form.provider} />
            </Field>
            <Field label="Adapter Type">
              <select className={inputClass} onChange={(e) => setForm({ ...form, adapterType: e.target.value })} value={form.adapterType}>
                <option value="openai_compatible">openai_compatible</option>
                <option value="openai_api">openai_api</option>
                <option value="claude_api">claude_api</option>
                <option value="claude_oauth">claude_oauth</option>
                <option value="codex">codex</option>
                <option value="github_copilot">github_copilot</option>
                <option value="gemini">gemini</option>
                <option value="antigravity">antigravity</option>
              </select>
            </Field>
            <Field label="Protocol">
              <input className={inputClass} onChange={(e) => setForm({ ...form, protocol: e.target.value })} value={form.protocol} />
            </Field>
            <Field label="Base URL" span={2}>
              <input className={inputClass} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} value={form.baseUrl} />
            </Field>
            <Field label="Status">
              <select className={inputClass} onChange={(e) => setForm({ ...form, status: e.target.value })} value={form.status}>
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
            <Field label="Priority">
              <input className={inputClass} onChange={(e) => setForm({ ...form, priority: e.target.value })} value={form.priority} />
            </Field>
            <Field label="Weight">
              <input className={inputClass} onChange={(e) => setForm({ ...form, weight: e.target.value })} value={form.weight} />
            </Field>
            <Field label="Capabilities JSON" span={2}>
              <textarea className={textareaClass} onChange={(e) => setForm({ ...form, capabilities: e.target.value })} value={form.capabilities} />
            </Field>
            <Field label="Config JSON" span={2}>
              <textarea className={textareaClass} onChange={(e) => setForm({ ...form, config: e.target.value })} value={form.config} />
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
        {channels.length === 0 ? (
          <EmptyState message="No channels yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Adapter</th>
                  <th className="px-3 py-2">Base URL</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {channels.map((channel) => (
                  <tr key={channel.id}>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <PlatformLogo
                          label={channel.provider}
                          platformId={channelPlatformId(channel)}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-800" title={channel.name}>
                            {channel.name}
                          </div>
                          <div className="truncate text-xs text-zinc-500" title={channel.provider}>
                            {channel.provider}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{channel.adapterType}</td>
                    <td className="max-w-sm truncate px-3 py-2 text-zinc-500">{channel.baseUrl ?? "-"}</td>
                    <td className="px-3 py-2"><StatusPill value={channel.status} /></td>
                    <td className="px-3 py-2">{channel.weight}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => setForm(fromChannel(channel))}>
                          <Pencil size={16} />
                        </IconButton>
                        <DeleteIconButton onClick={() => void remove(channel)} />
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
