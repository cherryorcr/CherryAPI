import { useEffect, useState } from "react";
import { Copy, Pencil } from "lucide-react";
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
import type { ApiKeyCreateResponse, ApiKeyRecord, GroupRecord } from "../types/admin";
import { formatDate, toNullableNumber, toNullableString } from "./helpers";

interface ApiKeyFormState {
  id?: string;
  name: string;
  groupId: string;
  status: string;
  quotaLimit: string;
  rpmLimit: string;
  tpmLimit: string;
  expiresAt: string;
}

const emptyApiKey: ApiKeyFormState = {
  name: "",
  groupId: "",
  status: "enabled",
  quotaLimit: "",
  rpmLimit: "",
  tpmLimit: "",
  expiresAt: ""
};

function fromApiKey(apiKey: ApiKeyRecord): ApiKeyFormState {
  return {
    id: apiKey.id,
    name: apiKey.name,
    groupId: apiKey.groupId,
    status: apiKey.status,
    quotaLimit: apiKey.quotaLimit === null ? "" : String(apiKey.quotaLimit),
    rpmLimit: apiKey.rpmLimit === null ? "" : String(apiKey.rpmLimit),
    tpmLimit: apiKey.tpmLimit === null ? "" : String(apiKey.tpmLimit),
    expiresAt: apiKey.expiresAt ?? ""
  };
}

export function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [form, setForm] = useState<ApiKeyFormState | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [nextKeys, nextGroups] = await Promise.all([
        apiGet<ApiKeyRecord[]>("/admin/api-keys"),
        apiGet<GroupRecord[]>("/admin/groups")
      ]);
      setApiKeys(nextKeys);
      setGroups(nextGroups);
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

  function groupName(id: string): string {
    return groups.find((group) => group.id === id)?.name ?? id;
  }

  function newForm() {
    setForm({
      ...emptyApiKey,
      groupId: groups[0]?.id ?? ""
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        group_id: form.groupId,
        status: form.status,
        quota_limit: toNullableNumber(form.quotaLimit, "quota_limit"),
        rpm_limit: toNullableNumber(form.rpmLimit, "rpm_limit"),
        tpm_limit: toNullableNumber(form.tpmLimit, "tpm_limit"),
        expires_at: toNullableString(form.expiresAt)
      };
      if (form.id) {
        await apiPatch<ApiKeyRecord>(`/admin/api-keys/${form.id}`, payload);
      } else {
        const created = await apiPost<ApiKeyCreateResponse>("/admin/api-keys", payload);
        setCreatedKey(created.key);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(apiKey: ApiKeyRecord) {
    if (!window.confirm(`Delete API key ${apiKey.name}?`)) return;
    await apiDelete(`/admin/api-keys/${apiKey.id}`);
    await load();
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New API Key" onClick={newForm} />
          </div>
        }
        description="Create CherryAPI keys bound only to groups."
        title="API Keys"
      />
      <ErrorBanner message={error} />

      {createdKey && (
        <Panel title="New API Key">
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">This plaintext key is shown once.</p>
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs">
              <span className="min-w-0 flex-1 break-all">{createdKey}</span>
              <Button onClick={() => void navigator.clipboard.writeText(createdKey)} variant="secondary">
                <Copy size={16} />
                Copy
              </Button>
            </div>
            <Button onClick={() => setCreatedKey(null)} variant="secondary">
              Close
            </Button>
          </div>
        </Panel>
      )}

      {form && (
        <Panel title={form.id ? "Edit API Key" : "New API Key"}>
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
            <Field label="Group">
              <select className={inputClass} onChange={(e) => setForm({ ...form, groupId: e.target.value })} value={form.groupId}>
                <option value="">Select group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} onChange={(e) => setForm({ ...form, status: e.target.value })} value={form.status}>
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </Field>
            <Field label="Quota Limit">
              <input className={inputClass} onChange={(e) => setForm({ ...form, quotaLimit: e.target.value })} value={form.quotaLimit} />
            </Field>
            <Field label="RPM Limit">
              <input className={inputClass} onChange={(e) => setForm({ ...form, rpmLimit: e.target.value })} value={form.rpmLimit} />
            </Field>
            <Field label="TPM Limit">
              <input className={inputClass} onChange={(e) => setForm({ ...form, tpmLimit: e.target.value })} value={form.tpmLimit} />
            </Field>
            <Field label="Expires At">
              <input className={inputClass} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} value={form.expiresAt} />
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
        {apiKeys.length === 0 ? (
          <EmptyState message="No API keys yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Quota</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {apiKeys.map((apiKey) => (
                  <tr key={apiKey.id}>
                    <td className="px-3 py-2 font-medium text-zinc-800">{apiKey.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{apiKey.keyPrefix}</td>
                    <td className="px-3 py-2">{groupName(apiKey.groupId)}</td>
                    <td className="px-3 py-2"><StatusPill value={apiKey.status} /></td>
                    <td className="px-3 py-2">{apiKey.quotaUsed}/{apiKey.quotaLimit ?? "none"}</td>
                    <td className="px-3 py-2 text-zinc-500">{formatDate(apiKey.expiresAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => setForm(fromApiKey(apiKey))}>
                          <Pencil size={16} />
                        </IconButton>
                        <DeleteIconButton onClick={() => void remove(apiKey)} />
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
