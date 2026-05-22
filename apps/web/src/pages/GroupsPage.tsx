import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, SlidersHorizontal } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../api/client";
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
  SuccessBanner,
  inputClass
} from "../components/ui";
import type {
  AccountRecord,
  ChannelRecord,
  GroupAccountRuleRecord,
  GroupChannelPermissionRecord,
  GroupEffectiveModelsResponse,
  GroupModelCandidate,
  GroupModelCandidateGroup,
  GroupModelCandidatesResponse,
  GroupRecord
} from "../types/admin";
import { formatDate, tagsFromText, toNullableString } from "./helpers";

interface GroupFormState {
  id?: string;
  name: string;
  description: string;
  status: string;
}

const emptyGroup: GroupFormState = {
  name: "",
  description: "",
  status: "enabled"
};

interface AccountRuleState {
  allowedTags: string;
  blockedTags: string;
  allowedAccountIds: string;
  blockedAccountIds: string;
}

interface RuleEditorState {
  channelId: string;
  draft: AccountRuleState;
}

type ModelSourceFilter = "all" | "selected" | "detected" | "account_alias" | "group_custom" | "stale";

const emptyRule: AccountRuleState = {
  allowedTags: "",
  blockedTags: "",
  allowedAccountIds: "",
  blockedAccountIds: ""
};

function fromGroup(group: GroupRecord): GroupFormState {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? "",
    status: group.status
  };
}

function fromRule(rule: GroupAccountRuleRecord): AccountRuleState {
  return {
    allowedTags: rule.allowedTags.join(", "),
    blockedTags: rule.blockedTags?.join(", ") ?? "",
    allowedAccountIds: rule.allowedAccountIds.join(", "),
    blockedAccountIds: rule.blockedAccountIds.join(", ")
  };
}

function candidateKey(publicModel: string, candidate: Pick<GroupModelCandidate, "accountId" | "upstreamModel" | "source">): string {
  return `${publicModel}\u0000${candidate.accountId}\u0000${candidate.upstreamModel}\u0000${candidate.source}`;
}

function sourceLabel(source: string): string {
  if (source === "detected") return "detected";
  if (source === "account_alias") return "account alias";
  if (source === "group_custom") return "group custom";
  return source;
}

function defaultSelectedModelCandidates(response: GroupModelCandidatesResponse): GroupModelCandidateGroup[] {
  return response.models.map((group) => ({
    ...group,
    candidates: group.candidates.map((candidate) => {
      if (candidate.bindingId) {
        return candidate;
      }
      return {
        ...candidate,
        selected: false,
        enabled: false
      };
    })
  }));
}

export function GroupsPage() {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [accountRules, setAccountRules] = useState<Record<string, AccountRuleState>>({});
  const [ruleEditor, setRuleEditor] = useState<RuleEditorState | null>(null);
  const [effective, setEffective] = useState<GroupEffectiveModelsResponse | null>(null);
  const [modelCandidates, setModelCandidates] = useState<GroupModelCandidateGroup[]>([]);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [customModelName, setCustomModelName] = useState("");
  const [customUpstreamModels, setCustomUpstreamModels] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [modelSourceFilter, setModelSourceFilter] = useState<ModelSourceFilter>("all");
  const [modelChannelFilter, setModelChannelFilter] = useState("all");
  const [form, setForm] = useState<GroupFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [nextGroups, nextChannels, nextAccounts] = await Promise.all([
        apiGet<GroupRecord[]>("/admin/groups"),
        apiGet<ChannelRecord[]>("/admin/channels"),
        apiGet<AccountRecord[]>("/admin/accounts")
      ]);
      setGroups(nextGroups);
      setChannels(nextChannels);
      setAccounts(nextAccounts);
      setSelectedGroupId((current) =>
        nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id || ""
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPermissions(groupId: string) {
    if (!groupId) return;
    try {
      const channelPermissions = await apiGet<GroupChannelPermissionRecord[]>(`/admin/groups/${groupId}/channel-permissions`);
      const [rules, nextEffective, nextCandidates] = await Promise.all([
        apiGet<GroupAccountRuleRecord[]>(`/admin/groups/${groupId}/account-rules`),
        apiGet<GroupEffectiveModelsResponse>(`/admin/groups/${groupId}/effective-models`),
        apiGet<GroupModelCandidatesResponse>(`/admin/groups/${groupId}/model-candidates`)
      ]);
      const nextRules: Record<string, AccountRuleState> = {};
      for (const rule of rules) {
        nextRules[rule.channelId] = fromRule(rule);
      }
      setSelectedChannelIds(new Set(channelPermissions.filter((permission) => permission.enabled).map((permission) => permission.channelId)));
      setAccountRules(nextRules);
      setEffective(nextEffective);
      const defaultedCandidates = defaultSelectedModelCandidates(nextCandidates);
      setModelCandidates(defaultedCandidates);
      setExpandedModels(new Set(defaultedCandidates.slice(0, 3).map((group) => group.publicModel)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadPermissions(selectedGroupId);
  }, [selectedGroupId]);

  async function savePermissionsForGroup(groupId: string) {
    await Promise.all([
      apiPut(`/admin/groups/${groupId}/channel-permissions`, {
        permissions: [...selectedChannelIds].map((channelId) => ({ channel_id: channelId, enabled: true }))
      }),
      apiPut(`/admin/groups/${groupId}/account-rules`, {
        rules: [...selectedChannelIds].map((channelId) => {
          const rule = ruleFor(channelId);
          return {
            channel_id: channelId,
            allowed_tags: tagsFromText(rule.allowedTags),
            blocked_tags: tagsFromText(rule.blockedTags),
            allowed_account_ids: tagsFromText(rule.allowedAccountIds),
            blocked_account_ids: tagsFromText(rule.blockedAccountIds)
          };
        })
      })
    ]);
  }

  async function saveGroup() {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: toNullableString(form.description),
        status: form.status
      };
      let savedGroupId = form.id;
      if (form.id) {
        await apiPatch<GroupRecord>(`/admin/groups/${form.id}`, payload);
        await savePermissionsForGroup(form.id);
        setSuccess("Group saved");
      } else {
        const created = await apiPost<GroupRecord>("/admin/groups", payload);
        await savePermissionsForGroup(created.id);
        savedGroupId = created.id;
        setSuccess("Group created");
      }
      setForm(null);
      setRuleEditor(null);
      await load();
      if (savedGroupId) {
        setSelectedGroupId(savedGroupId);
        await loadPermissions(savedGroupId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openNewGroupEditor() {
    setSelectedChannelIds(new Set());
    setAccountRules({});
    setRuleEditor(null);
    setForm(emptyGroup);
  }

  async function openGroupEditor(group: GroupRecord) {
    setSelectedGroupId(group.id);
    await loadPermissions(group.id);
    setForm(fromGroup(group));
  }

  function closeGroupEditor() {
    const groupId = form?.id;
    setForm(null);
    setRuleEditor(null);
    if (groupId) {
      void loadPermissions(groupId);
    } else if (selectedGroupId) {
      void loadPermissions(selectedGroupId);
    }
  }

  async function remove(group: GroupRecord) {
    if (!window.confirm(`Delete group ${group.name}?`)) return;
    await apiDelete(`/admin/groups/${group.id}`);
    if (selectedGroupId === group.id) {
      setSelectedGroupId("");
    }
    await load();
  }

  function toggle(setter: (value: Set<string>) => void, current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setter(next);
  }

  function ruleFor(channelId: string): AccountRuleState {
    return accountRules[channelId] ?? emptyRule;
  }

  function ruleFieldCount(rule: AccountRuleState): number {
    return [rule.allowedTags, rule.blockedTags, rule.allowedAccountIds, rule.blockedAccountIds].filter((value) =>
      value.trim()
    ).length;
  }

  function ruleSummary(channelId: string): string {
    if (!selectedChannelIds.has(channelId)) {
      return "Disabled for this group";
    }

    const count = ruleFieldCount(ruleFor(channelId));
    if (count === 0) {
      return "Default account matching";
    }

    return `${count} account rule field${count === 1 ? "" : "s"} configured`;
  }

  function matchedAccountCount(channelId: string): number {
    return effective?.effectiveAccounts.filter((account) => account.channelId === channelId).length ?? 0;
  }

  function openRuleEditor(channelId: string) {
    setRuleEditor({ channelId, draft: { ...ruleFor(channelId) } });
  }

  function updateRuleDraft(key: keyof AccountRuleState, value: string) {
    setRuleEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              [key]: value
            }
          }
        : current
    );
  }

  function applyRuleEditor() {
    if (!ruleEditor) return;
    setAccountRules((current) => ({
      ...current,
      [ruleEditor.channelId]: ruleEditor.draft
    }));
    setRuleEditor(null);
  }

  function accountName(id: string): string {
    return accounts.find((account) => account.id === id)?.name ?? id;
  }

  function channelName(id: string): string {
    return channels.find((channel) => channel.id === id)?.name ?? id;
  }

  function toggleExpanded(publicModel: string) {
    const next = new Set(expandedModels);
    if (next.has(publicModel)) {
      next.delete(publicModel);
    } else {
      next.add(publicModel);
    }
    setExpandedModels(next);
  }

  function modelBindingPayload(candidateGroups: GroupModelCandidateGroup[]) {
    return candidateGroups.flatMap((group) =>
      group.candidates
        .filter((candidate) => candidate.selected && candidate.available && !candidate.stale)
        .map((candidate) => ({
          public_model: group.publicModel,
          upstream_model: candidate.upstreamModel,
          channel_id: candidate.channelId,
          account_id: candidate.accountId,
          source: candidate.source,
          enabled: true,
          priority: candidate.priority,
          account_priority: candidate.accountPriority,
          weight: candidate.weight
        }))
    );
  }

  async function persistModelBindings(candidateGroups: GroupModelCandidateGroup[], message = "Model bindings saved") {
    if (!selectedGroupId) return;
    setSaving(true);
    try {
      await apiPut(`/admin/groups/${selectedGroupId}/model-bindings`, { bindings: modelBindingPayload(candidateGroups) });
      setSuccess(message);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateCandidate(
    publicModel: string,
    candidate: GroupModelCandidate,
    patch: Partial<Pick<GroupModelCandidate, "selected" | "priority" | "accountPriority" | "weight">>
  ) {
    const key = candidateKey(publicModel, candidate);
    const nextCandidates = modelCandidates.map((group) =>
      group.publicModel === publicModel
        ? {
            ...group,
            candidates: group.candidates.map((item) =>
              candidateKey(group.publicModel, item) === key ? { ...item, ...patch } : item
            )
          }
        : group
    );
    setModelCandidates(nextCandidates);
    await persistModelBindings(nextCandidates);
  }

  async function updateUpstreamModelPriority(publicModel: string, upstreamModel: string, priority: number) {
    const nextCandidates = modelCandidates.map((group) =>
      group.publicModel === publicModel
        ? {
            ...group,
            candidates: group.candidates.map((candidate) =>
              candidate.upstreamModel === upstreamModel ? { ...candidate, priority } : candidate
            )
          }
        : group
    );
    setModelCandidates(nextCandidates);
    await persistModelBindings(nextCandidates);
  }

  function detectedUpstreamModelOptions(): string[] {
    const upstreamModels = new Set<string>();
    for (const group of modelCandidates) {
      for (const candidate of group.candidates) {
        if (candidate.source === "detected" && candidate.available && !candidate.stale) {
          upstreamModels.add(candidate.upstreamModel);
        }
      }
    }
    return [...upstreamModels].sort((left, right) => left.localeCompare(right));
  }

  function setCustomUpstreamModel(upstreamModel: string, selected: boolean) {
    setCustomUpstreamModels((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(upstreamModel);
      } else {
        next.delete(upstreamModel);
      }
      return next;
    });
  }

  async function addCustomModel() {
    const name = customModelName.trim();
    if (!name) {
      setError("Custom model name is required.");
      return;
    }
    if (modelCandidates.some((group) => group.publicModel === name)) {
      setError("A model with that public name already exists in this group.");
      return;
    }

    const selectedUpstreamModels = detectedUpstreamModelOptions().filter((upstreamModel) =>
      customUpstreamModels.has(upstreamModel)
    );
    if (selectedUpstreamModels.length === 0) {
      setError("Select at least one upstream model before adding a custom model.");
      return;
    }

    const selectedUpstreamModelSet = new Set(selectedUpstreamModels);
    const modelPriorityByUpstream = new Map(
      selectedUpstreamModels.map((upstreamModel, index) => [upstreamModel, 100 + index * 10])
    );
    const upstreamCandidates = new Map<string, GroupModelCandidate>();
    for (const group of modelCandidates) {
      for (const candidate of group.candidates) {
        if (
          candidate.source !== "detected" ||
          !candidate.available ||
          candidate.stale ||
          !selectedUpstreamModelSet.has(candidate.upstreamModel)
        ) {
          continue;
        }
        upstreamCandidates.set(`${candidate.accountId}\u0000${candidate.upstreamModel}`, {
          ...candidate,
          source: "group_custom",
          selected: true,
          enabled: true,
          bindingId: null,
          priority: modelPriorityByUpstream.get(candidate.upstreamModel) ?? 100,
          accountPriority: 100,
          weight: 1
        });
      }
    }

    if (upstreamCandidates.size === 0) {
      setError("No detected available upstream models can be used for a custom model.");
      return;
    }

    const nextCandidates: GroupModelCandidateGroup[] = [
      ...modelCandidates,
      {
        publicModel: name,
        sources: ["group_custom"],
        candidates: [...upstreamCandidates.values()].sort((left, right) => {
          if (left.upstreamModel !== right.upstreamModel) return left.upstreamModel.localeCompare(right.upstreamModel);
          return left.accountName.localeCompare(right.accountName);
        })
      }
    ];
    setModelCandidates(nextCandidates);
    setExpandedModels(new Set([...expandedModels, name]));
    setCustomModelName("");
    setCustomUpstreamModels(new Set());
    setError(null);
    await persistModelBindings(nextCandidates, "Custom model saved");
  }

  async function removeCustomModel(publicModel: string) {
    const nextCandidates = modelCandidates.flatMap((group) => {
      if (group.publicModel !== publicModel) {
        return [group];
      }
      const candidates = group.candidates.filter((candidate) => candidate.source !== "group_custom");
      if (candidates.length === 0) {
        return [];
      }
      return [
        {
          ...group,
          sources: [...new Set(candidates.map((candidate) => candidate.source))],
          candidates
        }
      ];
    });
    setModelCandidates(nextCandidates);
    setExpandedModels((current) => {
      const next = new Set(current);
      next.delete(publicModel);
      return next;
    });
    setError(null);
    await persistModelBindings(nextCandidates, "Custom model removed");
  }

  const customTargetUpstreamOptions = detectedUpstreamModelOptions();
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const ruleEditorChannel = ruleEditor ? channels.find((channel) => channel.id === ruleEditor.channelId) : null;
  const selectedBindingCount = modelCandidates.reduce(
    (total, group) => total + group.candidates.filter((candidate) => candidate.selected).length,
    0
  );
  const selectedChannelSummary =
    selectedChannelIds.size === 0
      ? "No channels"
      : selectedChannelIds.size <= 3
        ? [...selectedChannelIds].map(channelName).join(", ")
        : `${selectedChannelIds.size} channels enabled`;
  const modelSearchQuery = modelSearch.trim().toLowerCase();
  const sourceFilterOptions: Array<{ value: ModelSourceFilter; label: string }> = [
    { value: "all", label: "All sources" },
    { value: "selected", label: "Selected only" },
    { value: "detected", label: "Detected" },
    { value: "account_alias", label: "Account alias" },
    { value: "group_custom", label: "Group custom" },
    { value: "stale", label: "Stale" }
  ];
  const filteredModelGroups = modelCandidates
    .map((group) => ({
      ...group,
      candidates: group.candidates.filter((candidate) => {
        if (modelSourceFilter === "selected" && !candidate.selected) return false;
        if (modelSourceFilter === "stale" && !candidate.stale) return false;
        if (
          modelSourceFilter !== "all" &&
          modelSourceFilter !== "selected" &&
          modelSourceFilter !== "stale" &&
          candidate.source !== modelSourceFilter
        ) {
          return false;
        }
        if (modelChannelFilter !== "all" && candidate.channelId !== modelChannelFilter) return false;
        if (!modelSearchQuery) return true;
        return [group.publicModel, candidate.accountName, candidate.channelName, candidate.upstreamModel, candidate.discoveryMode ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(modelSearchQuery);
      })
    }))
    .filter((group) => group.candidates.length > 0);
  const modelSections = [
    {
      title: "Custom Models",
      groups: filteredModelGroups.filter((group) => group.sources.includes("group_custom"))
    },
    {
      title: "Account Alias Models",
      groups: filteredModelGroups.filter((group) => !group.sources.includes("group_custom") && group.sources.includes("account_alias"))
    },
    {
      title: "Detected Models",
      groups: filteredModelGroups.filter(
        (group) => !group.sources.includes("group_custom") && !group.sources.includes("account_alias")
      )
    }
  ].filter((section) => section.groups.length > 0);

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New Group" onClick={openNewGroupEditor} />
          </div>
        }
        description="Groups own model and channel permissions. They do not own accounts."
        title="Groups"
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Panel title="Groups">
            {groups.length === 0 ? (
              <EmptyState message="No groups yet." />
            ) : (
              <div className="space-y-2">
                {groups.map((group) => {
                  const selected = selectedGroupId === group.id;
                  return (
                    <div
                      className={`rounded-md border p-3 ${
                        selected ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                      key={group.id}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <button className="min-w-0 text-left" onClick={() => setSelectedGroupId(group.id)} type="button">
                          <div className="truncate font-medium text-zinc-900">{group.name}</div>
                          <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{group.description ?? "No description"}</div>
                        </button>
                        <div className="justify-self-end self-start">
                          <StatusPill value={group.status} />
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => void openGroupEditor(group)}>
                          <Pencil size={16} />
                        </IconButton>
                        <DeleteIconButton onClick={() => void remove(group)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </aside>

        <div className="min-w-0 space-y-6">
          {selectedGroup && (
            <div className="rounded-md border border-zinc-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Selected Group</div>
                  <div className="mt-1 truncate text-lg font-semibold text-zinc-950">{selectedGroup.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">{selectedGroup.description ?? "No description"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill value={selectedGroup.status} />
                  <Button onClick={() => void openGroupEditor(selectedGroup)} variant="secondary">
                    <Pencil size={16} />
                    Edit Group
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm">
                  <div className="text-xs font-medium uppercase text-zinc-500">Channels</div>
                  <div className="mt-1 truncate text-zinc-900">{selectedChannelSummary}</div>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm">
                  <div className="text-xs font-medium uppercase text-zinc-500">Matched Accounts</div>
                  <div className="mt-1 text-zinc-900">{effective?.effectiveAccounts.length ?? 0}</div>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm">
                  <div className="text-xs font-medium uppercase text-zinc-500">Selected Bindings</div>
                  <div className="mt-1 text-zinc-900">{selectedBindingCount}</div>
                </div>
              </div>
            </div>
          )}

          <Panel title="Model Bindings">
            {!selectedGroupId ? (
              <EmptyState message="Select a group first." />
            ) : (
              <div className="space-y-5">
                <div className="rounded-md border border-zinc-200 p-3">
                  <div className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <Field label="Custom Public Model">
                        <input
                          className={`${inputClass} w-full`}
                          onChange={(event) => setCustomModelName(event.target.value)}
                          placeholder="auto"
                          value={customModelName}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={saving} onClick={() => void addCustomModel()} variant="secondary">
                          Add Custom
                        </Button>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium text-zinc-700">Target Upstream Models</div>
                      {customTargetUpstreamOptions.length === 0 ? (
                        <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-500">
                          No available detected upstream models.
                        </div>
                      ) : (
                        <div className="flex max-h-28 flex-wrap gap-2 overflow-auto rounded-md border border-zinc-200 p-2">
                          {customTargetUpstreamOptions.map((upstreamModel) => (
                            <label
                              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-700"
                              key={upstreamModel}
                            >
                              <input
                                checked={customUpstreamModels.has(upstreamModel)}
                                onChange={(event) => setCustomUpstreamModel(upstreamModel, event.target.checked)}
                                type="checkbox"
                              />
                              <span>{upstreamModel}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-zinc-200 p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                    <Field label="Search Models">
                      <input
                        className={`${inputClass} w-full`}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="model, account, upstream"
                        value={modelSearch}
                      />
                    </Field>
                    <Field label="Source">
                      <select
                        className={`${inputClass} w-full`}
                        onChange={(event) => setModelSourceFilter(event.target.value as ModelSourceFilter)}
                        value={modelSourceFilter}
                      >
                        {sourceFilterOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Channel">
                      <select
                        className={`${inputClass} w-full`}
                        onChange={(event) => setModelChannelFilter(event.target.value)}
                        value={modelChannelFilter}
                      >
                        <option value="all">All channels</option>
                        {channels.map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>

                {modelCandidates.length === 0 ? (
                  <EmptyState message="No detected or alias models are available for this group's matched accounts." />
                ) : modelSections.length === 0 ? (
                  <EmptyState message="No models match the current filters." />
                ) : (
                  <div className="space-y-5">
                    {modelSections.map((section) => (
                      <div className="space-y-3" key={section.title}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-zinc-800">{section.title}</div>
                          <div className="text-xs text-zinc-500">{section.groups.length} public models</div>
                        </div>
                        {section.groups.map((group) => {
                          const expanded = expandedModels.has(group.publicModel);
                          const selectedCount = group.candidates.filter((candidate) => candidate.selected).length;
                          const hasCustomRows = group.sources.includes("group_custom");
                          return (
                            <div className="rounded-md border border-zinc-200" key={group.publicModel}>
                              <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
                                <button
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                  onClick={() => toggleExpanded(group.publicModel)}
                                  type="button"
                                >
                                  {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  <span className="min-w-0 truncate font-medium text-zinc-900">{group.publicModel}</span>
                                  <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500">
                                    {group.sources.map(sourceLabel).join(", ")}
                                  </span>
                                </button>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="text-xs text-zinc-500">
                                    {selectedCount}/{group.candidates.length} selected
                                  </span>
                                  {hasCustomRows && <DeleteIconButton onClick={() => void removeCustomModel(group.publicModel)} />}
                                </div>
                              </div>
                              {expanded && (
                                <div className="border-t border-zinc-200 bg-zinc-50/50 p-3">
                                  <div className="grid gap-3 xl:grid-cols-2">
                                    {group.candidates.map((candidate) => (
                                      <div
                                        className="rounded-md border border-zinc-200 bg-white p-3"
                                        key={candidateKey(group.publicModel, candidate)}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <label className="flex min-w-0 items-start gap-2">
                                            <input
                                              checked={candidate.selected}
                                              className="mt-1"
                                              disabled={!candidate.available || candidate.stale}
                                              onChange={(event) =>
                                                void updateCandidate(group.publicModel, candidate, { selected: event.target.checked })
                                              }
                                              type="checkbox"
                                            />
                                            <span className="min-w-0">
                                              <span className="block truncate text-sm font-medium text-zinc-900">
                                                {candidate.accountName}
                                              </span>
                                              <span className="mt-1 block text-xs text-zinc-500">{candidate.channelName}</span>
                                            </span>
                                          </label>
                                          {candidate.stale ? (
                                            <span className="text-xs text-amber-600" title={candidate.staleReason ?? undefined}>
                                              stale
                                            </span>
                                          ) : (
                                            <StatusPill value={candidate.available ? "available" : "unavailable"} />
                                          )}
                                        </div>
                                        <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
                                          <div className="min-w-0">
                                            <div className="font-medium uppercase text-zinc-400">Upstream</div>
                                            <div className="break-all text-zinc-800">{candidate.upstreamModel}</div>
                                          </div>
                                          <div>
                                            <div className="font-medium uppercase text-zinc-400">Source</div>
                                            <div className="text-zinc-800">{sourceLabel(candidate.source)}</div>
                                          </div>
                                          <div>
                                            <div className="font-medium uppercase text-zinc-400">Detection Mode</div>
                                            <div className="text-zinc-800">{candidate.discoveryMode ?? "-"}</div>
                                          </div>
                                          <div>
                                            <div className="font-medium uppercase text-zinc-400">Last Checked</div>
                                            <div className="text-zinc-800">{formatDate(candidate.lastCheckedAt)}</div>
                                          </div>
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                          <Field label="Model Priority">
                                            <input
                                              className={`${inputClass} w-full`}
                                              min={1}
                                              onChange={(event) =>
                                                void updateUpstreamModelPriority(
                                                  group.publicModel,
                                                  candidate.upstreamModel,
                                                  Number.parseInt(event.target.value, 10) || 100
                                                )
                                              }
                                              type="number"
                                              value={candidate.priority}
                                            />
                                          </Field>
                                          <Field label="Account Priority">
                                            <input
                                              className={`${inputClass} w-full`}
                                              min={1}
                                              onChange={(event) =>
                                                void updateCandidate(group.publicModel, candidate, {
                                                  accountPriority: Number.parseInt(event.target.value, 10) || 100
                                                })
                                              }
                                              type="number"
                                              value={candidate.accountPriority}
                                            />
                                          </Field>
                                          <Field label="Weight">
                                            <input
                                              className={`${inputClass} w-full`}
                                              min={1}
                                              onChange={(event) =>
                                                void updateCandidate(group.publicModel, candidate, {
                                                  weight: Number.parseInt(event.target.value, 10) || 1
                                                })
                                              }
                                              type="number"
                                              value={candidate.weight}
                                            />
                                          </Field>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>

      <Panel title="Effective Access">
        {!selectedGroupId || !effective ? (
          <EmptyState message="Select a group to inspect effective accounts and models." />
        ) : (
          <div className="grid gap-6 xl:grid-cols-3">
            <div>
              <div className="mb-2 text-sm font-medium text-zinc-800">Effective Accounts</div>
              {effective.effectiveAccounts.length === 0 ? (
                <EmptyState message="No accounts match this group's channels and account rules." />
              ) : (
                <div className="space-y-2">
                  {effective.effectiveAccounts.map((account) => (
                    <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm" key={account.id}>
                      <div className="font-medium text-zinc-800">{account.name}</div>
                      <div className="text-xs text-zinc-500">{channelName(account.channelId)} · {account.tags.join(", ") || "-"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-zinc-800">Effective Upstream Models</div>
              {effective.effectiveUpstreamModels.length === 0 ? (
                <EmptyState message="No available detected models for the effective accounts." />
              ) : (
                <div className="space-y-2">
                  {effective.effectiveUpstreamModels.map((model) => (
                    <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm" key={model.upstreamModelName}>
                      <div className="font-medium text-zinc-800">{model.upstreamModelName}</div>
                      <div className="text-xs text-zinc-500">
                        {model.accountIds.map(accountName).join(", ")} · checked {formatDate(model.lastCheckedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-zinc-800">Exposed Public Models</div>
              {effective.exposedPublicModels.length === 0 ? (
                <EmptyState message="No public models are enabled for this group." />
              ) : (
                <div className="space-y-2">
                  {effective.exposedPublicModels.map((model) => (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm" key={model.id}>
                      <span className="font-medium text-zinc-800">{model.publicName}</span>
                      <StatusPill value={model.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
        </div>
      </div>

      {form && (
        <div aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-4" role="dialog">
          <form
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-white shadow-xl"
            onSubmit={(event) => {
              event.preventDefault();
              void saveGroup();
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Group Settings</div>
                <div className="mt-1 text-base font-semibold text-zinc-950">{form.id ? "Edit Group" : "New Group"}</div>
              </div>
              <CloseIconButton onClick={closeGroupEditor} />
            </div>
            <div className="space-y-5 overflow-y-auto p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name">
                  <input
                    className={`${inputClass} w-full`}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    value={form.name}
                  />
                </Field>
                <Field label="Status">
                  <select
                    className={`${inputClass} w-full`}
                    onChange={(event) => setForm({ ...form, status: event.target.value })}
                    value={form.status}
                  >
                    <option value="enabled">enabled</option>
                    <option value="disabled">disabled</option>
                  </select>
                </Field>
                <Field label="Description" span={2}>
                  <input
                    className={`${inputClass} w-full`}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    value={form.description}
                  />
                </Field>
              </div>

              <div className="rounded-md border border-zinc-200">
                <div className="border-b border-zinc-200 px-3 py-2">
                  <div className="text-sm font-medium text-zinc-800">Channels</div>
                  <div className="mt-1 text-xs text-zinc-500">Enable group access here. Use the sliders button for account rules.</div>
                </div>
                {channels.length === 0 ? (
                  <div className="p-3">
                    <EmptyState message="No channels yet." />
                  </div>
                ) : (
                  <div className="grid max-h-80 gap-2 overflow-y-auto p-3 md:grid-cols-2">
                    {channels.map((channel) => {
                      const enabled = selectedChannelIds.has(channel.id);
                      return (
                        <div
                          className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md border p-3 ${
                            enabled ? "border-zinc-300 bg-white" : "border-zinc-200 bg-zinc-50"
                          }`}
                          key={channel.id}
                        >
                          <label className="flex min-w-0 items-start gap-2">
                            <input
                              checked={enabled}
                              className="mt-1"
                              onChange={() => toggle(setSelectedChannelIds, selectedChannelIds, channel.id)}
                              type="checkbox"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-zinc-900">{channel.name}</span>
                              <span className="mt-1 block truncate text-xs text-zinc-500">
                                {enabled
                                  ? `${form.id ? `${matchedAccountCount(channel.id)} accounts · ` : ""}${ruleSummary(channel.id)}`
                                  : "Disabled"}
                              </span>
                            </span>
                          </label>
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!enabled}
                            onClick={() => openRuleEditor(channel.id)}
                            title="Edit account rules"
                            type="button"
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3">
              <Button onClick={closeGroupEditor} variant="secondary">
                Cancel
              </Button>
              <SaveButton disabled={saving} />
            </div>
          </form>
        </div>
      )}

      {ruleEditor && (
        <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4" role="dialog">
          <form
            className="w-full max-w-2xl rounded-md bg-white shadow-xl"
            onSubmit={(event) => {
              event.preventDefault();
              applyRuleEditor();
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Account Rules</div>
                <div className="mt-1 truncate text-base font-semibold text-zinc-950">
                  {ruleEditorChannel?.name ?? channelName(ruleEditor.channelId)}
                </div>
              </div>
              <CloseIconButton onClick={() => setRuleEditor(null)} />
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Allowed Tags">
                <input
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateRuleDraft("allowedTags", event.target.value)}
                  placeholder="normal, vip"
                  value={ruleEditor.draft.allowedTags}
                />
              </Field>
              <Field label="Blocked Tags">
                <input
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateRuleDraft("blockedTags", event.target.value)}
                  placeholder="disabled, canary"
                  value={ruleEditor.draft.blockedTags}
                />
              </Field>
              <Field label="Allowed Account IDs">
                <input
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateRuleDraft("allowedAccountIds", event.target.value)}
                  placeholder="blank means any matching account"
                  value={ruleEditor.draft.allowedAccountIds}
                />
              </Field>
              <Field label="Blocked Account IDs">
                <input
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateRuleDraft("blockedAccountIds", event.target.value)}
                  placeholder="acc_..."
                  value={ruleEditor.draft.blockedAccountIds}
                />
              </Field>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3">
              <Button onClick={() => setRuleEditor(null)} variant="secondary">
                Cancel
              </Button>
              <Button type="submit">Apply Rule</Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
