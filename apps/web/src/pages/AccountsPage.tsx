import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Gauge,
  Info,
  ListChecks,
  Minimize2,
  Pencil,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Tags,
  Trash2,
  UserPlus,
  X
} from "lucide-react";
import type { LoginMethodDefinition, PlatformId } from "@cherryapi/shared";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../api/client";
import {
  AddButton,
  Button,
  DeleteIconButton,
  EmptyState,
  ErrorBanner,
  Field,
  PageHeader,
  Panel,
  RefreshButton,
  SaveButton,
  StatusPill,
  SuccessBanner,
  inputClass,
  textareaClass
} from "../components/ui";
import { ModelDetectionResultPanel } from "../components/ModelDetectionResultPanel";
import { PlatformLogo } from "../components/PlatformLogo";
import { AccountQuotaPanel, ActionTagButton, DetailItem } from "./accounts/AccountFragments";
import { OnboardingSteps } from "./accounts/OnboardingSteps";
import {
  QUOTA_AUTO_REFRESH_MAX_AGE_MS,
  accountIdentity,
  accountModelCounts,
  accountPayloadFromForm,
  candidateModelsText,
  channelFormFromChannel,
  channelFormFromTemplate,
  channelPayloadFromChannelForm,
  channelPayloadFromForm,
  channelPlatformId,
  createDetectionRequestId,
  credentialLabel,
  credentialSummaryText,
  defaultAuthType,
  defaultConcurrency,
  defaultTags,
  detectionProgressStatusText,
  emptyAccount,
  formWithChannel,
  formWithChannelTemplate,
  fromAccount,
  initialDetectionProgress,
  jsonCredentialSummary,
  methodIcon,
  modelName,
  openAuthWindow,
  platformSlug,
  sourceLabel,
  summaryForAll,
  templateWithPreset
} from "./accounts/helpers";
import type {
  AccountFormState,
  ChannelFormState,
  ChannelMode,
  CodexOAuthState,
  CreatedAccountState,
  GitHubCopilotLocalImportState,
  GitHubCopilotOAuthState,
  ModelSyncDialogState,
  ModelSyncMode,
  PlatformSelection
} from "./accounts/types";
import { useAccountsData } from "./accounts/useAccountsData";
import type {
  AccountModelAliasRecord,
  AccountModelCapabilityRecord,
  AccountModelDetectionProgress,
  AccountModelDetectionResponse,
  AccountModelListResponse,
  AccountRecord,
  ChannelRecord,
  DetectedAccountModel,
  PlatformRecord
} from "../types/admin";
import { asJsonText, formatDate, parseJson, tagsFromText, toNullableNumber, toNullableString, toNumber } from "./helpers";

export function AccountsPage({ onGoToDiscovery = () => undefined }: { onGoToDiscovery?: () => void }) {
  const {
    accounts,
    setAccounts,
    channels,
    platforms,
    platformSummaries,
    capabilities,
    setCapabilities,
    error,
    setError,
    loading,
    load
  } = useAccountsData();
  const [aliasAccount, setAliasAccount] = useState<AccountRecord | null>(null);
  const [aliases, setAliases] = useState<AccountModelAliasRecord[]>([]);
  const [aliasForm, setAliasForm] = useState({ publicModel: "", upstreamModelName: "", enabled: true });
  const [selectedPlatformId, setSelectedPlatformId] = useState<PlatformSelection>("all");
  const [form, setForm] = useState<AccountFormState | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelFormState | null>(null);
  const [createdAccount, setCreatedAccount] = useState<CreatedAccountState | null>(null);
  const [detectionResult, setDetectionResult] = useState<AccountModelDetectionResponse | null>(null);
  const [detectionProgress, setDetectionProgress] = useState<AccountModelDetectionProgress | null>(null);
  const [detectingAccountId, setDetectingAccountId] = useState<string | null>(null);
  const [modelSyncDialog, setModelSyncDialog] = useState<ModelSyncDialogState | null>(null);
  const [checkingQuotaId, setCheckingQuotaId] = useState<string | null>(null);
  const [codexOAuth, setCodexOAuth] = useState<CodexOAuthState | null>(null);
  const [githubCopilotOAuth, setGitHubCopilotOAuth] = useState<GitHubCopilotOAuthState | null>(null);
  const [githubCopilotLocalImport, setGitHubCopilotLocalImport] = useState<GitHubCopilotLocalImportState | null>(null);
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const [platformSearch, setPlatformSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const autoQuotaAttemptsRef = useRef(new Set<string>());
  const [autoCheckingQuotaIds, setAutoCheckingQuotaIds] = useState<string[]>([]);

  useEffect(() => {
    if (!codexOAuth?.sessionId || codexOAuth.step !== "authorize") {
      return;
    }
    const interval = window.setInterval(() => {
      void apiGet<{ status: string; message?: string }>(`/admin/codex/oauth/status/${codexOAuth.sessionId}`)
        .then((status) => {
          setCodexOAuth((current) =>
            current?.sessionId === codexOAuth.sessionId
              ? { ...current, status: status.status, instructions: status.message ?? current.instructions }
              : current
          );
        })
        .catch((err) => setError((err as Error).message));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [codexOAuth?.sessionId, codexOAuth?.step]);

  useEffect(() => {
    if (
      !codexOAuth ||
      codexOAuth.step !== "authorize" ||
      codexOAuth.status !== "authorized" ||
      codexOAuth.completionStarted
    ) {
      return;
    }
    setCodexOAuth((current) =>
      current?.sessionId === codexOAuth.sessionId
        ? {
            ...current,
            completionStarted: true,
            instructions: "Authorization received. Completing Codex login..."
          }
        : current
    );
    void completeCodexOAuth(false);
  }, [codexOAuth?.status, codexOAuth?.completionStarted, codexOAuth?.sessionId, codexOAuth?.step]);

  useEffect(() => {
    if (!githubCopilotOAuth?.sessionId || githubCopilotOAuth.step !== "authorize") {
      return;
    }
    const interval = window.setInterval(() => {
      void apiGet<{
        status: string;
        message?: string;
        authUrl?: string;
        verificationUri?: string;
        verificationUriComplete?: string;
        userCode?: string;
      }>(`/admin/github-copilot/oauth/status/${githubCopilotOAuth.sessionId}`)
        .then((status) => {
          setGitHubCopilotOAuth((current) =>
            current?.sessionId === githubCopilotOAuth.sessionId
              ? {
                  ...current,
                  status: status.status,
                  instructions: status.message ?? current.instructions,
                  authUrl: status.authUrl ?? current.authUrl,
                  verificationUri: status.verificationUri ?? current.verificationUri,
                  verificationUriComplete: status.verificationUriComplete ?? current.verificationUriComplete,
                  userCode: status.userCode ?? current.userCode
                }
              : current
          );
        })
        .catch((err) => setError((err as Error).message));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [githubCopilotOAuth?.sessionId, githubCopilotOAuth?.step]);

  useEffect(() => {
    if (
      !githubCopilotOAuth ||
      githubCopilotOAuth.step !== "authorize" ||
      githubCopilotOAuth.status !== "authorized" ||
      githubCopilotOAuth.completionStarted
    ) {
      return;
    }
    setGitHubCopilotOAuth((current) =>
      current?.sessionId === githubCopilotOAuth.sessionId
        ? {
            ...current,
            completionStarted: true,
            instructions: "Authorization received. Completing GitHub Copilot login..."
          }
        : current
    );
    void completeGitHubCopilotOAuth(false);
  }, [githubCopilotOAuth?.status, githubCopilotOAuth?.completionStarted, githubCopilotOAuth?.sessionId, githubCopilotOAuth?.step]);

  useEffect(() => {
    if (!detailAccountId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailAccountId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailAccountId]);

  const platformById = useMemo(() => new Map(platforms.map((platform) => [platform.id, platform])), [platforms]);
  const summaryById = useMemo(
    () => new Map(platformSummaries.map((summary) => [summary.id, summary])),
    [platformSummaries]
  );
  const allSummary = useMemo(() => summaryForAll(platformSummaries), [platformSummaries]);
  const visiblePlatforms = useMemo(
    () =>
      platforms.filter((platform) =>
        platform.name.toLowerCase().includes(platformSearch.trim().toLowerCase())
      ),
    [platformSearch, platforms]
  );

  function channelName(id: string): string {
    return channels.find((channel) => channel.id === id)?.name ?? id;
  }

  function channelForAccount(account: AccountRecord): ChannelRecord | undefined {
    return channels.find((channel) => channel.id === account.channelId);
  }

  function channelsForPlatform(platformId: PlatformSelection): ChannelRecord[] {
    if (platformId === "all") {
      return channels;
    }
    return channels.filter((channel) => channelPlatformId(channel) === platformId);
  }

  const selectedPlatform = selectedPlatformId === "all" ? undefined : platformById.get(selectedPlatformId);
  const selectedSummary = selectedPlatformId === "all" ? allSummary : summaryById.get(selectedPlatformId);
  const selectedChannels = channelsForPlatform(selectedPlatformId);
  const selectedChannelIds = new Set(selectedChannels.map((channel) => channel.id));
  const filteredAccounts =
    selectedPlatformId === "all" ? accounts : accounts.filter((account) => selectedChannelIds.has(account.channelId));

  function accountSupportsQuotaCheck(account: AccountRecord): boolean {
    const channel = channelForAccount(account);
    return channel?.adapterType === "codex" || channel?.adapterType === "github_copilot";
  }

  function accountQuotaLastAttemptAt(account: AccountRecord): number | null {
    const timestamps = [account.quotaCheckedAt, account.quotaSnapshot?.checkedAt, account.quotaLastErrorAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((value) => Number.isFinite(value));
    return timestamps.length ? Math.max(...timestamps) : null;
  }

  function accountNeedsAutoQuotaCheck(account: AccountRecord): boolean {
    if (!accountSupportsQuotaCheck(account) || autoQuotaAttemptsRef.current.has(account.id)) {
      return false;
    }
    const lastAttempt = accountQuotaLastAttemptAt(account);
    return lastAttempt === null || Date.now() - lastAttempt > QUOTA_AUTO_REFRESH_MAX_AGE_MS;
  }

  useEffect(() => {
    const candidates = filteredAccounts.filter(accountNeedsAutoQuotaCheck);
    if (candidates.length === 0) {
      return;
    }

    let cancelled = false;
    for (const account of candidates) {
      autoQuotaAttemptsRef.current.add(account.id);
    }
    setAutoCheckingQuotaIds((current) => [...new Set([...current, ...candidates.map((account) => account.id)])]);

    void (async () => {
      for (const account of candidates) {
        try {
          const updated = await apiPost<AccountRecord>(`/admin/accounts/${account.id}/check-quota`, {});
          if (!cancelled) {
            setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
          }
        } catch {
          try {
            const updated = await apiGet<AccountRecord>(`/admin/accounts/${account.id}`);
            if (!cancelled) {
              setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            }
          } catch {
            // The visible card keeps its current state; manual refresh will surface the error.
          }
        } finally {
          if (!cancelled) {
            setAutoCheckingQuotaIds((current) => current.filter((id) => id !== account.id));
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts, channels, selectedPlatformId]);

  function firstChannelForPlatform(platformId: PlatformSelection): ChannelRecord | undefined {
    return channelsForPlatform(platformId)[0] ?? channels[0];
  }

  function defaultChannelMode(platform: PlatformRecord, platformChannels: ChannelRecord[]): ChannelMode {
    if (platform.id === "openai_compatible") {
      return "create_new";
    }
    return platformChannels.length ? "use_existing" : "auto_create";
  }

  function startGenericAdd() {
    if (selectedPlatform) {
      const method = selectedPlatform.supportedLoginMethods.find((item) => item.implemented);
      if (method) {
        startAddWithMethod(selectedPlatform, method);
        return;
      }
    }
    const channel = firstChannelForPlatform("all");
    setCodexOAuth(null);
    setGitHubCopilotOAuth(null);
    setGitHubCopilotLocalImport(null);
    setForm(formWithChannel({ ...emptyAccount, name: "account-main" }, channel));
  }

  function startAddWithMethod(platform: PlatformRecord, method: LoginMethodDefinition) {
    if (platform.id === "codex" && method.id === "oauth_login") {
      setCodexOAuth({
        step: "setup",
        accountName: "codex-oauth",
        tags: "coding, normal",
        channelMode: channelsForPlatform("codex").length ? "auto_create" : "auto_create",
        channelId: channelsForPlatform("codex")[0]?.id ?? "",
        sessionId: "",
        expiresAt: null,
        instructions: null,
        authUrl: null,
        credential: "",
        status: "idle",
        completionStarted: false,
        authWindowOpened: false
      });
      setForm(null);
      setGitHubCopilotOAuth(null);
      setGitHubCopilotLocalImport(null);
      return;
    }
    if (platform.id === "github_copilot" && method.id === "oauth_login") {
      setGitHubCopilotOAuth({
        step: "setup",
        accountName: "github-copilot-oauth",
        tags: "coding, normal",
        channelMode: channelsForPlatform("github_copilot").length ? "use_existing" : "auto_create",
        channelId: channelsForPlatform("github_copilot")[0]?.id ?? "",
        sessionId: "",
        expiresAt: null,
        instructions: null,
        authUrl: null,
        verificationUri: null,
        verificationUriComplete: null,
        userCode: null,
        credential: "",
        status: "idle",
        completionStarted: false,
        authWindowOpened: false
      });
      setCodexOAuth(null);
      setForm(null);
      setGitHubCopilotLocalImport(null);
      return;
    }
    if (platform.id === "github_copilot" && method.id === "local_vscode_import") {
      setGitHubCopilotLocalImport({
        accountName: "github-copilot-local",
        tags: "coding, normal",
        channelMode: channelsForPlatform("github_copilot").length ? "use_existing" : "auto_create",
        channelId: channelsForPlatform("github_copilot")[0]?.id ?? "",
        userDataDir: ""
      });
      setCodexOAuth(null);
      setGitHubCopilotOAuth(null);
      setForm(null);
      return;
    }
    const platformChannels = channelsForPlatform(platform.id);
    const channelMode = defaultChannelMode(platform, platformChannels);
    const channel = platformChannels[0];
    const preset = platform.channelPresets?.[0];
    const template = templateWithPreset(platform, preset);
    const baseForm: AccountFormState = {
      ...emptyAccount,
      platformId: platform.id,
      channelMode,
      channelPresetId: preset?.id ?? "custom",
      loginMethodId: method.id,
      loginMethodType: method.type,
      name: `${platformSlug(platform)}-main`,
      authType: defaultAuthType(method, platform.id),
      tags: defaultTags(platform.id),
      concurrencyLimit: defaultConcurrency(platform.id)
    };
    const withTemplate = formWithChannelTemplate(baseForm, template);
    setCodexOAuth(null);
    setGitHubCopilotOAuth(null);
    setGitHubCopilotLocalImport(null);
    setForm(channelMode === "use_existing" ? formWithChannel(withTemplate, channel) : withTemplate);
  }

  function startAddWithChannel(channel: ChannelRecord) {
    const platform = platformById.get(channelPlatformId(channel));
    if (!platform) {
      setForm(formWithChannel({ ...emptyAccount, name: "account-main" }, channel));
      setCodexOAuth(null);
      setGitHubCopilotOAuth(null);
      setGitHubCopilotLocalImport(null);
      return;
    }

    const method = platform.supportedLoginMethods.find((item) => item.implemented);
    if (!method) {
      setError(`${platform.name} does not have an implemented login method yet.`);
      return;
    }

    if (platform.id === "codex" && method.id === "oauth_login") {
      setCodexOAuth({
        step: "setup",
        accountName: "codex-oauth",
        tags: "coding, normal",
        channelMode: "use_existing",
        channelId: channel.id,
        sessionId: "",
        expiresAt: null,
        instructions: null,
        authUrl: null,
        credential: "",
        status: "idle",
        completionStarted: false,
        authWindowOpened: false
      });
      setGitHubCopilotOAuth(null);
      setGitHubCopilotLocalImport(null);
      setForm(null);
      return;
    }

    if (platform.id === "github_copilot" && method.id === "oauth_login") {
      setGitHubCopilotOAuth({
        step: "setup",
        accountName: "github-copilot-oauth",
        tags: "coding, normal",
        channelMode: "use_existing",
        channelId: channel.id,
        sessionId: "",
        expiresAt: null,
        instructions: null,
        authUrl: null,
        verificationUri: null,
        verificationUriComplete: null,
        userCode: null,
        credential: "",
        status: "idle",
        completionStarted: false,
        authWindowOpened: false
      });
      setCodexOAuth(null);
      setGitHubCopilotLocalImport(null);
      setForm(null);
      return;
    }

    const baseForm: AccountFormState = {
      ...emptyAccount,
      platformId: platform.id,
      channelMode: "use_existing",
      channelPresetId: platform.channelPresets?.[0]?.id ?? "custom",
      channelId: channel.id,
      loginMethodId: method.id,
      loginMethodType: method.type,
      name: `${platformSlug(platform)}-main`,
      authType: defaultAuthType(method, platform.id),
      tags: defaultTags(platform.id),
      concurrencyLimit: defaultConcurrency(platform.id)
    };
    setCodexOAuth(null);
    setGitHubCopilotOAuth(null);
    setGitHubCopilotLocalImport(null);
    setForm(formWithChannel(baseForm, channel));
    setError(null);
  }

  function updateFormChannel(channelId: string) {
    if (!form) return;
    setForm(formWithChannel({ ...form, channelId }, channels.find((channel) => channel.id === channelId)));
  }

  function updateChannelPreset(presetId: string) {
    if (!form || form.platformId === "all") return;
    const platform = platformById.get(form.platformId);
    const preset = platform?.channelPresets?.find((item) => item.id === presetId);
    setForm(formWithChannelTemplate({ ...form, channelPresetId: presetId }, templateWithPreset(platform, preset)));
  }

  function updateChannelMode(mode: ChannelMode) {
    if (!form) return;
    if (mode === "use_existing") {
      setForm(formWithChannel({ ...form, channelMode: mode }, formChannels[0]));
      return;
    }
    const platform = form.platformId === "all" ? undefined : platformById.get(form.platformId);
    const preset = platform?.channelPresets?.find((item) => item.id === form.channelPresetId) ?? platform?.channelPresets?.[0];
    setForm(
      formWithChannelTemplate(
        {
          ...form,
          channelMode: mode,
          channelPresetId: preset?.id ?? form.channelPresetId
        },
        templateWithPreset(platform, preset)
      )
    );
  }

  function startNewChannel(platform: PlatformRecord) {
    const template = templateWithPreset(platform, platform.channelPresets?.[0]) ?? {
      name: platform.name,
      provider: platform.channelProvider,
      adapterType: platform.defaultAdapterType,
      protocol: platform.defaultProtocol,
      baseUrl: null,
      status: "enabled" as const,
      config: {}
    };
    setChannelForm(channelFormFromTemplate(platform.id, template));
  }

  async function saveChannelForm() {
    if (!channelForm) return;
    setSaving(true);
    try {
      if (channelForm.platformId === "openai_compatible" && !channelForm.baseUrl.trim()) {
        throw new Error("base_url is required for OpenAI-compatible channels");
      }
      const payload = channelPayloadFromChannelForm(channelForm);
      if (channelForm.id) {
        await apiPatch<ChannelRecord>(`/admin/channels/${channelForm.id}`, payload);
      } else {
        await apiPost<ChannelRecord>("/admin/channels", payload);
      }
      setChannelForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function startCodexOAuth() {
    if (!codexOAuth) return;
    if (codexOAuth.channelMode === "use_existing" && !codexOAuth.channelId) {
      setError("Select a Codex channel before starting OAuth login.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiPost<{
        sessionId: string;
        authUrl?: string;
        expiresAt?: string;
        instructions: string;
      }>("/admin/codex/oauth/start", {
        channelMode: codexOAuth.channelMode,
        ...(codexOAuth.channelMode === "use_existing" ? { channelId: codexOAuth.channelId } : {}),
        accountDefaults: {
          name: codexOAuth.accountName,
          tags: tagsFromText(codexOAuth.tags),
          weight: 1,
          concurrency_limit: 1,
          status: "enabled"
        }
      });
      const authWindowOpened = openAuthWindow(response.authUrl);
      setCodexOAuth({
        ...codexOAuth,
        step: "authorize",
        sessionId: response.sessionId,
        expiresAt: response.expiresAt ?? null,
        instructions: response.instructions,
        authUrl: response.authUrl ?? null,
        status: "pending",
        completionStarted: false,
        authWindowOpened
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function completeCodexOAuth(useFallbackCredential: boolean) {
    if (!codexOAuth) return;
    setSaving(true);
    try {
      const response = await apiPost<{ account: AccountRecord; channel: ChannelRecord }>("/admin/codex/oauth/complete", {
        sessionId: codexOAuth.sessionId,
        ...(useFallbackCredential ? { credential: codexOAuth.credential } : {})
      });
      const platform = platformById.get("codex");
      setCreatedAccount({ account: response.account, channel: response.channel, platform });
      setCodexOAuth(null);
      setSuccess("Codex OAuth account created.");
      await load();
    } catch (err) {
      setCodexOAuth((current) =>
        current?.sessionId === codexOAuth.sessionId
          ? {
              ...current,
              status: "failed",
              completionStarted: false,
              instructions: "OAuth login could not be completed. Retry or use Manual JSON Import as fallback."
            }
          : current
      );
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function cancelCodexOAuth() {
    if (codexOAuth?.sessionId) {
      try {
        await apiPost("/admin/codex/oauth/cancel", { sessionId: codexOAuth.sessionId });
      } catch {
        // Session may already be expired; closing the panel is still safe.
      }
    }
    setCodexOAuth(null);
  }

  async function startGitHubCopilotOAuth() {
    if (!githubCopilotOAuth) return;
    if (githubCopilotOAuth.channelMode === "use_existing" && !githubCopilotOAuth.channelId) {
      setError("Select a GitHub Copilot channel before starting OAuth login.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiPost<{
        sessionId: string;
        authUrl?: string;
        verificationUri?: string;
        verificationUriComplete?: string;
        userCode?: string;
        expiresAt?: string;
        instructions: string;
      }>("/admin/github-copilot/oauth/start", {
        channelMode: githubCopilotOAuth.channelMode,
        ...(githubCopilotOAuth.channelMode === "use_existing" ? { channelId: githubCopilotOAuth.channelId } : {}),
        accountDefaults: {
          name: githubCopilotOAuth.accountName,
          tags: tagsFromText(githubCopilotOAuth.tags),
          weight: 1,
          concurrency_limit: 1,
          status: "enabled"
        }
      });
      const authWindowOpened = openAuthWindow(response.authUrl);
      setGitHubCopilotOAuth({
        ...githubCopilotOAuth,
        step: "authorize",
        sessionId: response.sessionId,
        expiresAt: response.expiresAt ?? null,
        instructions: response.instructions,
        authUrl: response.authUrl ?? null,
        verificationUri: response.verificationUri ?? null,
        verificationUriComplete: response.verificationUriComplete ?? null,
        userCode: response.userCode ?? null,
        status: "pending",
        completionStarted: false,
        authWindowOpened
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function completeGitHubCopilotOAuth(useFallbackCredential: boolean) {
    if (!githubCopilotOAuth) return;
    setSaving(true);
    try {
      const response = await apiPost<{ account: AccountRecord; channel: ChannelRecord }>("/admin/github-copilot/oauth/complete", {
        sessionId: githubCopilotOAuth.sessionId,
        ...(useFallbackCredential ? { credential: githubCopilotOAuth.credential } : {})
      });
      const platform = platformById.get("github_copilot");
      setCreatedAccount({ account: response.account, channel: response.channel, platform });
      setGitHubCopilotOAuth(null);
      setSuccess("GitHub Copilot account created.");
      await load();
    } catch (err) {
      setGitHubCopilotOAuth((current) =>
        current?.sessionId === githubCopilotOAuth.sessionId
          ? {
              ...current,
              status: "failed",
              completionStarted: false,
              instructions: "GitHub Copilot login could not be completed. Retry or use a GitHub access token fallback."
            }
          : current
      );
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function cancelGitHubCopilotOAuth() {
    if (githubCopilotOAuth?.sessionId) {
      try {
        await apiPost("/admin/github-copilot/oauth/cancel", { sessionId: githubCopilotOAuth.sessionId });
      } catch {
        // Session may already be expired; closing the panel is still safe.
      }
    }
    setGitHubCopilotOAuth(null);
  }

  async function importGitHubCopilotFromLocalVSCode() {
    if (!githubCopilotLocalImport) return;
    if (githubCopilotLocalImport.channelMode === "use_existing" && !githubCopilotLocalImport.channelId) {
      setError("Select a GitHub Copilot channel before importing from VS Code.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiPost<{ account: AccountRecord; channel: ChannelRecord }>("/admin/github-copilot/local-vscode", {
        channelMode: githubCopilotLocalImport.channelMode,
        ...(githubCopilotLocalImport.channelMode === "use_existing" ? { channelId: githubCopilotLocalImport.channelId } : {}),
        ...(githubCopilotLocalImport.userDataDir.trim() ? { userDataDir: githubCopilotLocalImport.userDataDir.trim() } : {}),
        accountDefaults: {
          name: githubCopilotLocalImport.accountName,
          tags: tagsFromText(githubCopilotLocalImport.tags),
          weight: 1,
          concurrency_limit: 1,
          status: "enabled"
        }
      });
      const platform = platformById.get("github_copilot");
      setCreatedAccount({ account: response.account, channel: response.channel, platform });
      setGitHubCopilotLocalImport(null);
      setSuccess("GitHub Copilot account imported from VS Code.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshGitHubCopilotAccount(account: AccountRecord) {
    setSaving(true);
    try {
      await apiPost<AccountRecord>(`/admin/github-copilot/accounts/${account.id}/refresh`, {});
      setSuccess(`GitHub Copilot credential refreshed for ${account.name}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function checkAccountQuota(account: AccountRecord) {
    if (checkingQuotaId) {
      return;
    }
    setCheckingQuotaId(account.id);
    setError(null);
    try {
      const updated = await apiPost<AccountRecord>(`/admin/accounts/${account.id}/check-quota`, {});
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSuccess(`Quota checked for ${account.name}.`);
    } catch (err) {
      await load();
      setError((err as Error).message);
    } finally {
      setCheckingQuotaId(null);
    }
  }

  async function maybeUpdateChannel(formState: AccountFormState) {
    const channel = channels.find((item) => item.id === formState.channelId);
    if (!channel) {
      return;
    }

    const baseUrlChanged = (channel.baseUrl ?? "") !== formState.channelBaseUrl.trim();

    if (!baseUrlChanged) {
      return;
    }

    const nextConfig = { ...channel.config };
    delete nextConfig.candidateModels;
    delete nextConfig.candidate_models;

    await apiPatch<ChannelRecord>(`/admin/channels/${channel.id}`, {
      base_url: toNullableString(formState.channelBaseUrl),
      config: nextConfig
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      if (!form.id && !form.credential.trim()) {
        throw new Error("credential is required when creating an account");
      }
      if (form.loginMethodType === "json_import" && form.credential.trim()) {
        JSON.parse(form.credential);
      }

      if (form.id) {
        await maybeUpdateChannel(form);
        const payload: Record<string, unknown> = {
          channel_id: form.channelId,
          name: form.name,
          auth_type: form.authType,
          proxy: toNullableString(form.proxy),
          tags: tagsFromText(form.tags),
          weight: toNumber(form.weight, "weight", 1),
          concurrency_limit: toNumber(form.concurrencyLimit, "concurrency_limit", 5),
          status: form.status,
          health_status: form.healthStatus,
          quota_limit: toNullableNumber(form.quotaLimit, "quota_limit"),
          cooldown_until: toNullableString(form.cooldownUntil)
        };
        if (form.credential.trim()) {
          payload.credential = form.credential.trim();
        }
        await apiPatch<AccountRecord>(`/admin/accounts/${form.id}`, payload);
      } else if (form.platformId === "github_copilot" && form.loginMethodId === "github_access_token") {
        const response = await apiPost<{ channel: ChannelRecord; account: AccountRecord }>("/admin/github-copilot/token", {
          credential: form.credential.trim(),
          channelMode: form.channelMode,
          ...(form.channelMode === "use_existing" ? { channelId: form.channelId } : { channel: channelPayloadFromForm(form) }),
          account: accountPayloadFromForm(form)
        });
        setCreatedAccount({
          account: response.account,
          channel: response.channel,
          platform: platformById.get("github_copilot")
        });
        setSuccess("GitHub Copilot account created.");
      } else if (form.platformId !== "all" && form.loginMethodId) {
        const response = await apiPost<{ channel: ChannelRecord; account: AccountRecord }>(`/admin/platforms/${form.platformId}/accounts`, {
          loginMethodId: form.loginMethodId,
          channelMode: form.channelMode,
          ...(form.channelMode === "use_existing" ? { channelId: form.channelId } : { channel: channelPayloadFromForm(form) }),
          account: accountPayloadFromForm(form)
        });
        setCreatedAccount({
          account: response.account,
          channel: response.channel,
          platform: platformById.get(form.platformId)
        });
        setSuccess("Account created.");
      } else {
        const payload = {
          channel_id: form.channelId,
          ...accountPayloadFromForm(form)
        };
        const account = await apiPost<AccountRecord>("/admin/accounts", payload);
        const channel = channels.find((item) => item.id === account.channelId);
        if (channel) {
          setCreatedAccount({ account, channel, platform: undefined });
        }
        setSuccess("Account created.");
      }
      setForm(null);
      await load();
    } catch (err) {
      const message = err instanceof SyntaxError ? "credential JSON must be valid JSON" : (err as Error).message;
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(account: AccountRecord) {
    if (!window.confirm(`Delete account ${account.name}?`)) return;
    await apiDelete(`/admin/accounts/${account.id}`);
    await load();
  }

  async function accountAction(account: AccountRecord, action: "clear-error" | "reset-concurrency" | "enable" | "disable") {
    try {
      await apiPatch<AccountRecord>(`/admin/accounts/${account.id}/${action}`, {});
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openModelSyncDialog(account: AccountRecord) {
    setModelSyncDialog({
      accountId: account.id,
      mode: "auto",
      minimized: false,
      models: [],
      selectedModelNames: [],
      search: "",
      loadingList: false,
      listError: null,
      warnings: []
    });
    setDetectionProgress(null);
    setDetectionResult(null);
    setError(null);
  }

  function closeModelSyncDialog() {
    if (detectingAccountId || modelSyncDialog?.loadingList) {
      return;
    }
    setModelSyncDialog(null);
    setDetectionProgress(null);
  }

  function minimizeModelSyncDialog() {
    setModelSyncDialog((current) => (current ? { ...current, minimized: true } : current));
  }

  function restoreModelSyncDialog() {
    setModelSyncDialog((current) => (current ? { ...current, minimized: false } : current));
  }

  async function runModelSyncRequest(
    account: AccountRecord,
    requestId: string,
    request: () => Promise<AccountModelDetectionResponse>,
    successMessage: (response: AccountModelDetectionResponse) => string
  ) {
    if (detectingAccountId) {
      return;
    }
    setDetectingAccountId(account.id);
    setDetectionProgress(initialDetectionProgress(account, requestId));
    setDetectionResult(null);
    setError(null);
    let polling = true;
    const pollProgress = async () => {
      try {
        const progress = await apiGet<AccountModelDetectionProgress>(
          `/admin/accounts/${account.id}/detect-models/progress/${requestId}`
        );
        if (polling) {
          setDetectionProgress(progress);
        }
      } catch {
        // The progress row may not exist until the POST handler starts.
      }
    };
    const intervalId = window.setInterval(() => void pollProgress(), 500);
    void pollProgress();

    try {
      const response = await request();
      const total = response.summary?.total ?? response.capabilities.length;
      setDetectionProgress((current) =>
        current?.requestId === requestId
          ? {
              ...current,
              status: "completed",
              total,
              completed: total,
              currentModel: null,
              updatedAt: new Date().toISOString(),
              error: null
            }
          : current
      );
      setDetectionResult(response);
      setSuccess(successMessage(response));
      await load();
    } catch (err) {
      const message = (err as Error).message;
      setDetectionProgress((current) =>
        current?.requestId === requestId
          ? {
              ...current,
              status: "failed",
              currentModel: null,
              updatedAt: new Date().toISOString(),
              error: message
            }
          : current
      );
      setError(message);
    } finally {
      polling = false;
      window.clearInterval(intervalId);
      setDetectingAccountId(null);
    }
  }

  async function detectModels(account: AccountRecord) {
    const requestId = createDetectionRequestId();
    await runModelSyncRequest(
      account,
      requestId,
      () => apiPost<AccountModelDetectionResponse>(`/admin/accounts/${account.id}/detect-models`, { requestId }),
      (response) => `Synced and tested ${response.summary?.total ?? response.capabilities.length} upstream models for ${account.name}.`
    );
  }

  async function fetchModelList(account: AccountRecord) {
    if (!modelSyncDialog || modelSyncDialog.loadingList || detectingAccountId) {
      return;
    }

    const requestId = createDetectionRequestId();
    setModelSyncDialog({
      ...modelSyncDialog,
      loadingList: true,
      listError: null,
      warnings: []
    });
    setError(null);
    try {
      const response = await apiPost<AccountModelListResponse>(`/admin/accounts/${account.id}/list-models`, { requestId });
      setModelSyncDialog((current) =>
        current?.accountId === account.id
          ? {
              ...current,
              models: response.models,
              selectedModelNames: [],
              loadingList: false,
              listError: response.listError,
              warnings: response.warnings ?? []
            }
          : current
      );
      if (response.models.length === 0) {
        setError(response.listError ?? "No upstream models were returned.");
      }
    } catch (err) {
      const message = (err as Error).message;
      setModelSyncDialog((current) =>
        current?.accountId === account.id
          ? {
              ...current,
              loadingList: false,
              listError: message
            }
          : current
      );
      setError(message);
    }
  }

  function setManualModelSelected(model: DetectedAccountModel, selected: boolean) {
    if (!modelSyncDialog) return;
    const name = modelName(model);
    const next = new Set(modelSyncDialog.selectedModelNames);
    if (selected) {
      next.add(name);
    } else {
      next.delete(name);
    }
    setModelSyncDialog({
      ...modelSyncDialog,
      selectedModelNames: [...next]
    });
  }

  function selectVisibleManualModels(models: DetectedAccountModel[], selected: boolean) {
    if (!modelSyncDialog) return;
    const next = new Set(modelSyncDialog.selectedModelNames);
    for (const model of models) {
      if (selected) {
        next.add(modelName(model));
      } else {
        next.delete(modelName(model));
      }
    }
    setModelSyncDialog({
      ...modelSyncDialog,
      selectedModelNames: [...next]
    });
  }

  async function testSelectedModels(account: AccountRecord, selectedModels: DetectedAccountModel[]) {
    if (selectedModels.length === 0) {
      setError("Select at least one model to test.");
      return;
    }
    const requestId = createDetectionRequestId();
    await runModelSyncRequest(
      account,
      requestId,
      () =>
        apiPost<AccountModelDetectionResponse>(`/admin/accounts/${account.id}/test-models`, {
          requestId,
          models: selectedModels
        }),
      (response) => `Tested ${response.summary?.total ?? response.capabilities.length} selected upstream models for ${account.name}.`
    );
  }

  function availableCapabilitiesForAccount(accountId: string): AccountModelCapabilityRecord[] {
    return capabilities
      .filter((capability) => capability.accountId === accountId && capability.status === "available")
      .sort((left, right) => left.upstreamModelName.localeCompare(right.upstreamModelName));
  }

  async function openAliasPanel(account: AccountRecord) {
    try {
      const nextAliases = await apiGet<AccountModelAliasRecord[]>(`/admin/accounts/${account.id}/model-aliases`);
      const available = availableCapabilitiesForAccount(account.id);
      setAliasAccount(account);
      setAliases(nextAliases);
      setAliasForm({
        publicModel: "",
        upstreamModelName: available[0]?.upstreamModelName ?? "",
        enabled: true
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function reloadAliases(accountId = aliasAccount?.id) {
    if (!accountId) return;
    setAliases(await apiGet<AccountModelAliasRecord[]>(`/admin/accounts/${accountId}/model-aliases`));
  }

  async function saveAlias() {
    if (!aliasAccount) return;
    try {
      await apiPost<AccountModelAliasRecord>(`/admin/accounts/${aliasAccount.id}/model-aliases`, {
        public_model: aliasForm.publicModel,
        upstream_model: aliasForm.upstreamModelName,
        enabled: aliasForm.enabled
      });
      setAliasForm({
        publicModel: "",
        upstreamModelName: availableCapabilitiesForAccount(aliasAccount.id)[0]?.upstreamModelName ?? "",
        enabled: true
      });
      await reloadAliases(aliasAccount.id);
      setSuccess("Account model alias saved.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function updateAlias(alias: AccountModelAliasRecord, patch: Partial<AccountModelAliasRecord>) {
    if (!aliasAccount) return;
    try {
      await apiPut<AccountModelAliasRecord>(`/admin/accounts/${aliasAccount.id}/model-aliases/${alias.id}`, {
        public_model: patch.publicModel ?? alias.publicModel,
        upstream_model: patch.upstreamModelName ?? alias.upstreamModelName,
        enabled: patch.enabled ?? alias.enabled
      });
      await reloadAliases(aliasAccount.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeAlias(alias: AccountModelAliasRecord) {
    if (!aliasAccount || !window.confirm(`Delete alias ${alias.publicModel}?`)) return;
    try {
      await apiDelete(`/admin/accounts/${aliasAccount.id}/model-aliases/${alias.id}`);
      await reloadAliases(aliasAccount.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const credentialHint = form?.loginMethodType === "json_import" ? jsonCredentialSummary(form.credential) : null;
  const formChannels = form ? channelsForPlatform(form.platformId) : [];
  const formPlatform = form && form.platformId !== "all" ? platformById.get(form.platformId) : undefined;
  const formPresets = formPlatform?.channelPresets ?? [];
  const detailAccount = detailAccountId ? accounts.find((account) => account.id === detailAccountId) ?? null : null;
  const detailChannel = detailAccount ? channelForAccount(detailAccount) : undefined;
  const detailPlatform = detailChannel ? platformById.get(channelPlatformId(detailChannel)) : undefined;
  const detailCounts = detailAccount ? accountModelCounts(detailAccount.id, capabilities) : null;
  const detailCapabilities = detailAccount
    ? capabilities
        .filter((capability) => capability.accountId === detailAccount.id)
        .sort((left, right) => left.upstreamModelName.localeCompare(right.upstreamModelName))
    : [];
  const progressTotal = detectionProgress?.total;
  const progressCompleted = detectionProgress
    ? Math.min(detectionProgress.completed, progressTotal ?? detectionProgress.completed)
    : 0;
  const progressPercent =
    progressTotal && progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : detectionProgress?.status === "completed" ? 100 : 0;
  const modelSyncAccount = modelSyncDialog
    ? accounts.find((account) => account.id === modelSyncDialog.accountId) ??
      (createdAccount?.account.id === modelSyncDialog.accountId ? createdAccount.account : null)
    : null;
  const modelSyncChannel = modelSyncAccount ? channelForAccount(modelSyncAccount) : undefined;
  const modelSyncPlatform = modelSyncChannel ? platformById.get(channelPlatformId(modelSyncChannel)) : undefined;
  const modelSyncQuery = modelSyncDialog?.search.trim().toLowerCase() ?? "";
  const visibleManualModels =
    modelSyncDialog?.models.filter((model) => {
      if (!modelSyncQuery) return true;
      return [model.upstreamModelName, model.displayName, model.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(modelSyncQuery);
    }) ?? [];
  const selectedManualModels = modelSyncDialog
    ? modelSyncDialog.models.filter((model) => modelSyncDialog.selectedModelNames.includes(modelName(model)))
    : [];
  const modelSyncWarnings = modelSyncDialog
    ? modelSyncDialog.warnings.filter((warning) => !modelSyncDialog.listError || !warning.includes(modelSyncDialog.listError))
    : [];
  const modelSyncProgress =
    detectionProgress && modelSyncAccount && detectionProgress.accountId === modelSyncAccount.id ? detectionProgress : null;
  const modelSyncIsDone = modelSyncProgress?.status === "completed" || modelSyncProgress?.status === "failed";
  const modelSyncStatusText = modelSyncProgress
    ? detectionProgressStatusText(modelSyncProgress.status)
    : modelSyncDialog?.loadingList
      ? "Fetching models"
      : "Ready";

  function AccountActionTags({
    account,
    accountChannel,
    showDetails = true
  }: {
    account: AccountRecord;
    accountChannel?: ChannelRecord;
    showDetails?: boolean;
  }) {
    const accountPlatform = accountChannel ? platformById.get(channelPlatformId(accountChannel)) : undefined;
    const modelDetectionDisabled = Boolean(detectingAccountId) || accountPlatform?.supportsModelDetection === false;
    const quotaCheckSupported = accountChannel?.adapterType === "codex" || accountChannel?.adapterType === "github_copilot";
    const quotaChecking = checkingQuotaId === account.id || autoCheckingQuotaIds.includes(account.id);
    const quotaCheckDisabled = Boolean(checkingQuotaId) || autoCheckingQuotaIds.includes(account.id) || !quotaCheckSupported;

    return (
      <>
        {showDetails && (
          <ActionTagButton icon={<Info size={13} />} onClick={() => setDetailAccountId(account.id)} variant="primary">
            Details
          </ActionTagButton>
        )}
        <ActionTagButton
          icon={<Pencil size={13} />}
          onClick={() => {
            setForm(fromAccount(account, accountChannel));
            setCodexOAuth(null);
            setGitHubCopilotOAuth(null);
            setGitHubCopilotLocalImport(null);
            setDetailAccountId(null);
          }}
        >
          Edit
        </ActionTagButton>
        <ActionTagButton
          disabled={modelDetectionDisabled}
          icon={<SearchCheck size={13} />}
          onClick={() => openModelSyncDialog(account)}
          title={accountPlatform?.supportsModelDetection === false ? "Model detection is not supported for this platform" : undefined}
        >
          {detectingAccountId === account.id ? "Syncing" : "Sync Models"}
        </ActionTagButton>
        <ActionTagButton
          disabled={quotaCheckDisabled}
          icon={<Gauge size={13} />}
          onClick={() => void checkAccountQuota(account)}
          title={quotaCheckSupported ? "Check upstream quota" : "Quota check is not implemented for this adapter"}
        >
          {quotaChecking ? "Checking" : "Quota"}
        </ActionTagButton>
        <ActionTagButton
          icon={<Tags size={13} />}
          onClick={() => {
            setDetailAccountId(null);
            void openAliasPanel(account);
          }}
        >
          Aliases
        </ActionTagButton>
        {accountPlatform?.id === "github_copilot" && (
          <ActionTagButton disabled={saving} icon={<RefreshCw size={13} />} onClick={() => void refreshGitHubCopilotAccount(account)}>
            Refresh
          </ActionTagButton>
        )}
        {account.lastError && (
          <ActionTagButton icon={<X size={13} />} onClick={() => void accountAction(account, "clear-error")}>
            Clear Error
          </ActionTagButton>
        )}
        <ActionTagButton icon={<RotateCcw size={13} />} onClick={() => void accountAction(account, "reset-concurrency")}>
          Reset
        </ActionTagButton>
        {account.status === "enabled" ? (
          <ActionTagButton icon={<PowerOff size={13} />} onClick={() => void accountAction(account, "disable")}>
            Disable
          </ActionTagButton>
        ) : (
          <ActionTagButton icon={<Power size={13} />} onClick={() => void accountAction(account, "enable")}>
            Enable
          </ActionTagButton>
        )}
        <ActionTagButton icon={<Trash2 size={13} />} onClick={() => void remove(account)} variant="danger">
          Delete
        </ActionTagButton>
      </>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        action={
          <div className="flex gap-2">
            <RefreshButton disabled={loading} onClick={load} />
            <AddButton label="New Account" onClick={startGenericAdd} />
          </div>
        }
        description="Manage platform accounts, encrypted credentials, health, quota, and detected models."
        title="Accounts"
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <OnboardingSteps
        accountCount={filteredAccounts.length}
        capabilityCount={capabilities.filter((capability) => selectedPlatformId === "all" || selectedChannelIds.has(capability.channelId)).length}
        selectedPlatformName={selectedPlatform?.name ?? "All platforms"}
      />

      <div className={sidebarCollapsed ? "grid gap-4 lg:grid-cols-[72px_minmax(0,1fr)]" : "grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"}>
        <aside className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            {!sidebarCollapsed && <div className="text-sm font-medium text-zinc-800">Platforms</div>}
            <button
              className="h-8 rounded-md border border-zinc-200 px-2 text-xs text-zinc-600 hover:bg-zinc-50"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              type="button"
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
          </div>
          {!sidebarCollapsed && (
            <input
              className={`${inputClass} mb-3 w-full`}
              onChange={(event) => setPlatformSearch(event.target.value)}
              placeholder="Search platforms"
              value={platformSearch}
            />
          )}
          <div className="space-y-2">
            <button
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selectedPlatformId === "all" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:bg-zinc-50"
              }`}
              onClick={() => setSelectedPlatformId("all")}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformLogo label="All Platforms" platformId="all" selected={selectedPlatformId === "all"} size="sm" />
                  {!sidebarCollapsed && <span className="font-medium">All</span>}
                </span>
                {!sidebarCollapsed && <span className="text-xs opacity-80">{allSummary.accountsTotal}</span>}
              </div>
              {!sidebarCollapsed && <div className="mt-1 text-xs opacity-80">
                {allSummary.healthyAccounts} healthy / {allSummary.degradedAccounts} degraded / {allSummary.disabledAccounts} disabled
              </div>}
            </button>

            {visiblePlatforms.map((platform) => {
              const summary = summaryById.get(platform.id);
              const selected = selectedPlatformId === platform.id;
              return (
                <button
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:bg-zinc-50"
                  }`}
                  key={platform.id}
                  onClick={() => setSelectedPlatformId(platform.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <PlatformLogo label={platform.name} platformId={platform.id} selected={selected} size="sm" />
                      {!sidebarCollapsed && (
                        <span className="truncate font-medium" title={platform.name}>
                          {platform.name}
                        </span>
                      )}
                    </span>
                    {!sidebarCollapsed && <span className="text-xs opacity-80">{summary?.accountsTotal ?? 0}</span>}
                  </div>
                  {!sidebarCollapsed && <div className="mt-1 flex items-center justify-between gap-2 text-xs opacity-80">
                    <span>
                      {summary?.healthyAccounts ?? 0} / {summary?.degradedAccounts ?? 0} / {summary?.disabledAccounts ?? 0}
                    </span>
                    <span>{platform.implementationStatus}</span>
                  </div>}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="space-y-4">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <PlatformLogo
                  label={selectedPlatform?.name ?? "All Platforms"}
                  platformId={selectedPlatform?.id ?? "all"}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-zinc-950">{selectedPlatform?.name ?? "All Platforms"}</h2>
                    <StatusPill value={selectedSummary?.implementationStatus ?? "available"} />
                  </div>
                  <p className="mt-1 max-w-3xl text-sm text-zinc-500">
                    {selectedPlatform?.description ??
                      "All accounts across every platform. Select a platform on the left to see its login methods and filtered accounts."}
                  </p>
                  {selectedPlatform && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>{selectedPlatform.supportedLoginMethods.length} login methods</span>
                      <span>model detection: {selectedPlatform.supportsModelDetection ? "yes" : "no"}</span>
                      <span>quota: {selectedPlatform.supportsQuota ? "yes" : "no"}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-md border border-zinc-200 px-3 py-2">
                  <div className="text-xs text-zinc-500">Accounts</div>
                  <div className="font-semibold">{selectedSummary?.accountsTotal ?? 0}</div>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2">
                  <div className="text-xs text-zinc-500">Healthy</div>
                  <div className="font-semibold">{selectedSummary?.healthyAccounts ?? 0}</div>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2">
                  <div className="text-xs text-zinc-500">Degraded</div>
                  <div className="font-semibold">{selectedSummary?.degradedAccounts ?? 0}</div>
                </div>
                <div className="rounded-md border border-zinc-200 px-3 py-2">
                  <div className="text-xs text-zinc-500">Channels</div>
                  <div className="font-semibold">{selectedSummary?.channelsTotal ?? selectedChannels.length}</div>
                </div>
              </div>
            </div>
          </Panel>

          {selectedPlatform && (
            <Panel
              title="Channels for This Platform"
            >
              <div className="mb-3 flex justify-end">
                <Button onClick={() => startNewChannel(selectedPlatform)} variant="secondary">
                  Create Channel
                </Button>
              </div>
              {selectedChannels.length === 0 ? (
                <EmptyState message="No channels for this platform yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Adapter</th>
                        <th className="px-3 py-2">Base URL</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Accounts</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {selectedChannels.map((channel) => (
                        <tr key={channel.id}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 font-medium text-zinc-800">
                              <PlatformLogo label={selectedPlatform.name} platformId={selectedPlatform.id} size="xs" />
                              <span className="min-w-0 truncate" title={channel.name}>
                                {channel.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-zinc-500">{channel.adapterType}</td>
                          <td className="max-w-sm truncate px-3 py-2 text-zinc-500">{channel.baseUrl ?? "-"}</td>
                          <td className="px-3 py-2">
                            <StatusPill value={channel.status} />
                          </td>
                          <td className="px-3 py-2">{accounts.filter((account) => account.channelId === channel.id).length}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <Button
                                disabled={!selectedPlatform.supportedLoginMethods.some((method) => method.implemented)}
                                onClick={() => startAddWithChannel(channel)}
                                title={
                                  selectedPlatform.supportedLoginMethods.some((method) => method.implemented)
                                    ? "Use this channel for a new account"
                                    : "No implemented login method for this platform"
                                }
                                variant="secondary"
                              >
                                <UserPlus size={16} />
                                Use
                              </Button>
                              <Button onClick={() => setChannelForm(channelFormFromChannel(channel))} variant="secondary">
                                <Pencil size={16} />
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {channelForm && (
            <Panel title={channelForm.id ? "Edit Channel" : "Create Channel"}>
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveChannelForm();
                }}
              >
                <Field label="Name">
                  <input className={inputClass} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} value={channelForm.name} />
                </Field>
                <Field label="Provider">
                  <input
                    className={inputClass}
                    onChange={(e) => setChannelForm({ ...channelForm, provider: e.target.value })}
                    value={channelForm.provider}
                  />
                </Field>
                <Field label="Adapter Type">
                  <input
                    className={inputClass}
                    onChange={(e) => setChannelForm({ ...channelForm, adapterType: e.target.value })}
                    value={channelForm.adapterType}
                  />
                </Field>
                <Field label="Protocol">
                  <input
                    className={inputClass}
                    onChange={(e) => setChannelForm({ ...channelForm, protocol: e.target.value })}
                    value={channelForm.protocol}
                  />
                </Field>
                <Field label="Base URL" span={2}>
                  <input
                    className={inputClass}
                    onChange={(e) => setChannelForm({ ...channelForm, baseUrl: e.target.value })}
                    value={channelForm.baseUrl}
                  />
                </Field>
                <Field label="Status">
                  <select className={inputClass} onChange={(e) => setChannelForm({ ...channelForm, status: e.target.value })} value={channelForm.status}>
                    <option value="enabled">enabled</option>
                    <option value="disabled">disabled</option>
                  </select>
                </Field>
                <Field label="Config JSON" span={2}>
                  <textarea className={textareaClass} onChange={(e) => setChannelForm({ ...channelForm, config: e.target.value })} value={channelForm.config} />
                </Field>
                <div className="flex gap-2 md:col-span-2">
                  <SaveButton disabled={saving} />
                  <Button onClick={() => setChannelForm(null)} variant="secondary">
                    Cancel
                  </Button>
                </div>
              </form>
            </Panel>
          )}

          {selectedPlatform && (
            <Panel title="Login / Import Methods">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {selectedPlatform.supportedLoginMethods.map((method) => (
                  <div className="rounded-md border border-zinc-200 p-3" key={method.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 text-zinc-500">{methodIcon(method)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900">{method.label}</div>
                          <div className="mt-1 text-xs text-zinc-500">{method.description ?? method.type}</div>
                        </div>
                      </div>
                      <StatusPill value={method.implemented ? "available" : "planned"} />
                    </div>
                    <Button
                      disabled={!method.implemented}
                      onClick={() => startAddWithMethod(selectedPlatform, method)}
                      variant="secondary"
                    >
                      {method.implemented ? "Add" : "Coming Soon"}
                    </Button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {codexOAuth && (
            <Panel title="Codex OAuth Login">
              <div className="space-y-4">
                {codexOAuth.step === "setup" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Account Name">
                      <input
                        className={inputClass}
                        onChange={(event) => setCodexOAuth({ ...codexOAuth, accountName: event.target.value })}
                        value={codexOAuth.accountName}
                      />
                    </Field>
                    <Field label="Tags">
                      <input
                        className={inputClass}
                        onChange={(event) => setCodexOAuth({ ...codexOAuth, tags: event.target.value })}
                        value={codexOAuth.tags}
                      />
                    </Field>
                    <Field label="Channel Mode">
                      <select
                        className={inputClass}
                        onChange={(event) => setCodexOAuth({ ...codexOAuth, channelMode: event.target.value as ChannelMode })}
                        value={codexOAuth.channelMode}
                      >
                        <option value="auto_create">auto_create</option>
                        <option value="use_existing">use_existing</option>
                        <option value="create_new">create_new</option>
                      </select>
                    </Field>
                    {codexOAuth.channelMode === "use_existing" && (
                      <Field label="Codex Channel">
                        <select
                          className={inputClass}
                          onChange={(event) => setCodexOAuth({ ...codexOAuth, channelId: event.target.value })}
                          value={codexOAuth.channelId}
                        >
                          <option value="">Select channel</option>
                          {channelsForPlatform("codex").map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <div className="flex gap-2 md:col-span-2">
                      <Button disabled={saving} onClick={() => void startCodexOAuth()}>
                        Start OAuth Login
                      </Button>
                      <Button onClick={() => void cancelCodexOAuth()} variant="secondary">
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {codexOAuth.step === "authorize" && (
                  <div className="space-y-4">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      {codexOAuth.instructions}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusPill value={codexOAuth.status} />
                      {codexOAuth.expiresAt && <span className="text-zinc-500">expires {formatDate(codexOAuth.expiresAt)}</span>}
                      {codexOAuth.authUrl && (
                        <Button onClick={() => openAuthWindow(codexOAuth.authUrl)} variant="secondary">
                          Open Login Page
                        </Button>
                      )}
                    </div>
                    {!codexOAuth.authWindowOpened && codexOAuth.authUrl && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        The browser may have blocked the popup. Use Open Login Page, then return here after authorization.
                      </div>
                    )}
                    {codexOAuth.status === "authorized" && (
                      <div className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">
                        Authorization received. CherryAPI is exchanging the code and saving the account.
                      </div>
                    )}
                    {codexOAuth.status === "failed" && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        Authorization was received, but the token exchange did not complete. You can retry without opening the login page again.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        disabled={
                          saving ||
                          (codexOAuth.status !== "authorized" && codexOAuth.status !== "failed") ||
                          codexOAuth.completionStarted
                        }
                        onClick={() => void completeCodexOAuth(false)}
                      >
                        {codexOAuth.status === "failed" ? "Retry Complete" : "Complete Login"}
                      </Button>
                      <Button onClick={() => void cancelCodexOAuth()} variant="secondary">
                        Cancel
                      </Button>
                    </div>
                    <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                      <summary className="cursor-pointer font-medium text-zinc-800">
                        OAuth Login failed or callback unavailable? Use Manual JSON Import as fallback.
                      </summary>
                      <div className="mt-3 space-y-3">
                        <Field label="Codex OAuth JSON" span={2}>
                          <textarea
                            className={textareaClass}
                            onChange={(event) => setCodexOAuth({ ...codexOAuth, credential: event.target.value })}
                            value={codexOAuth.credential}
                          />
                        </Field>
                        <Button
                          disabled={saving || !codexOAuth.credential.trim()}
                          onClick={() => void completeCodexOAuth(true)}
                          variant="secondary"
                        >
                          Save JSON Fallback
                        </Button>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {githubCopilotOAuth && (
            <Panel title="GitHub Copilot Login">
              <div className="space-y-4">
                {githubCopilotOAuth.step === "setup" && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Account Name">
                      <input
                        className={inputClass}
                        onChange={(event) => setGitHubCopilotOAuth({ ...githubCopilotOAuth, accountName: event.target.value })}
                        value={githubCopilotOAuth.accountName}
                      />
                    </Field>
                    <Field label="Tags">
                      <input
                        className={inputClass}
                        onChange={(event) => setGitHubCopilotOAuth({ ...githubCopilotOAuth, tags: event.target.value })}
                        value={githubCopilotOAuth.tags}
                      />
                    </Field>
                    <Field label="Channel Mode">
                      <select
                        className={inputClass}
                        onChange={(event) => setGitHubCopilotOAuth({ ...githubCopilotOAuth, channelMode: event.target.value as ChannelMode })}
                        value={githubCopilotOAuth.channelMode}
                      >
                        <option value="auto_create">auto_create</option>
                        <option value="use_existing">use_existing</option>
                        <option value="create_new">create_new</option>
                      </select>
                    </Field>
                    {githubCopilotOAuth.channelMode === "use_existing" && (
                      <Field label="GitHub Copilot Channel">
                        <select
                          className={inputClass}
                          onChange={(event) => setGitHubCopilotOAuth({ ...githubCopilotOAuth, channelId: event.target.value })}
                          value={githubCopilotOAuth.channelId}
                        >
                          <option value="">Select channel</option>
                          {channelsForPlatform("github_copilot").map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <div className="flex gap-2 md:col-span-2">
                      <Button disabled={saving} onClick={() => void startGitHubCopilotOAuth()}>
                        Start GitHub OAuth
                      </Button>
                      <Button onClick={() => void cancelGitHubCopilotOAuth()} variant="secondary">
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {githubCopilotOAuth.step === "authorize" && (
                  <div className="space-y-4">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      {githubCopilotOAuth.instructions}
                    </div>
                    {githubCopilotOAuth.userCode && (
                      <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Device Code</div>
                          <div className="mt-1 font-mono text-2xl font-semibold tracking-wide text-zinc-950">
                            {githubCopilotOAuth.userCode}
                          </div>
                        </div>
                        {githubCopilotOAuth.authUrl && (
                          <Button onClick={() => openAuthWindow(githubCopilotOAuth.authUrl)} variant="secondary">
                            Open GitHub
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusPill value={githubCopilotOAuth.status} />
                      {githubCopilotOAuth.expiresAt && <span className="text-zinc-500">expires {formatDate(githubCopilotOAuth.expiresAt)}</span>}
                      {githubCopilotOAuth.verificationUri && (
                        <span className="break-all text-zinc-500">{githubCopilotOAuth.verificationUri}</span>
                      )}
                    </div>
                    {!githubCopilotOAuth.authWindowOpened && githubCopilotOAuth.authUrl && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        The browser may have blocked the popup. Use Open GitHub, then return here after authorization.
                      </div>
                    )}
                    {githubCopilotOAuth.status === "authorized" && (
                      <div className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-800">
                        Authorization received. CherryAPI is exchanging the GitHub token and saving the Copilot account.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        disabled={saving || githubCopilotOAuth.status !== "authorized" || githubCopilotOAuth.completionStarted}
                        onClick={() => void completeGitHubCopilotOAuth(false)}
                      >
                        Complete Login
                      </Button>
                      <Button onClick={() => void cancelGitHubCopilotOAuth()} variant="secondary">
                        Cancel
                      </Button>
                    </div>
                    <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                      <summary className="cursor-pointer font-medium text-zinc-800">
                        Device authorization failed? Use a GitHub access token fallback.
                      </summary>
                      <div className="mt-3 space-y-3">
                        <Field label="GitHub Access Token" span={2}>
                          <input
                            className={inputClass}
                            onChange={(event) => setGitHubCopilotOAuth({ ...githubCopilotOAuth, credential: event.target.value })}
                            type="password"
                            value={githubCopilotOAuth.credential}
                          />
                        </Field>
                        <Button
                          disabled={saving || !githubCopilotOAuth.credential.trim()}
                          onClick={() => void completeGitHubCopilotOAuth(true)}
                          variant="secondary"
                        >
                          Save Token Fallback
                        </Button>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {githubCopilotLocalImport && (
            <Panel title="Import GitHub Copilot from VS Code">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Account Name">
                  <input
                    className={inputClass}
                    onChange={(event) => setGitHubCopilotLocalImport({ ...githubCopilotLocalImport, accountName: event.target.value })}
                    value={githubCopilotLocalImport.accountName}
                  />
                </Field>
                <Field label="Tags">
                  <input
                    className={inputClass}
                    onChange={(event) => setGitHubCopilotLocalImport({ ...githubCopilotLocalImport, tags: event.target.value })}
                    value={githubCopilotLocalImport.tags}
                  />
                </Field>
                <Field label="Channel Mode">
                  <select
                    className={inputClass}
                    onChange={(event) => setGitHubCopilotLocalImport({ ...githubCopilotLocalImport, channelMode: event.target.value as ChannelMode })}
                    value={githubCopilotLocalImport.channelMode}
                  >
                    <option value="auto_create">auto_create</option>
                    <option value="use_existing">use_existing</option>
                    <option value="create_new">create_new</option>
                  </select>
                </Field>
                {githubCopilotLocalImport.channelMode === "use_existing" && (
                  <Field label="GitHub Copilot Channel">
                    <select
                      className={inputClass}
                      onChange={(event) => setGitHubCopilotLocalImport({ ...githubCopilotLocalImport, channelId: event.target.value })}
                      value={githubCopilotLocalImport.channelId}
                    >
                      <option value="">Select channel</option>
                      {channelsForPlatform("github_copilot").map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="VS Code User Data Dir" span={2}>
                  <input
                    className={inputClass}
                    onChange={(event) => setGitHubCopilotLocalImport({ ...githubCopilotLocalImport, userDataDir: event.target.value })}
                    placeholder="Leave blank to auto-detect"
                    value={githubCopilotLocalImport.userDataDir}
                  />
                </Field>
                <div className="flex gap-2 md:col-span-2">
                  <Button disabled={saving} onClick={() => void importGitHubCopilotFromLocalVSCode()}>
                    Import from VS Code
                  </Button>
                  <Button onClick={() => setGitHubCopilotLocalImport(null)} variant="secondary">
                    Cancel
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {createdAccount && (
            <Panel title="Account Created">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <PlatformLogo
                    label={createdAccount.platform?.name}
                    platformId={createdAccount.platform?.id}
                    size="md"
                  />
                  <div className="min-w-0 space-y-1 text-sm">
                    <div className="font-medium text-zinc-900">{createdAccount.account.name}</div>
                    <div className="text-zinc-500">
                      {createdAccount.platform?.name ?? "Platform"} · {createdAccount.channel.name} · {createdAccount.account.tags.join(", ")}
                    </div>
                    <div className="text-zinc-500">{credentialSummaryText(createdAccount.account.credentialSummary)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={Boolean(detectingAccountId) || createdAccount.platform?.supportsModelDetection === false}
                    onClick={() => openModelSyncDialog(createdAccount.account)}
                  >
                    {detectingAccountId === createdAccount.account.id ? "Syncing..." : "Sync Models"}
                  </Button>
                  <Button onClick={onGoToDiscovery} variant="secondary">
                    Go to Model Sync & Checks
                  </Button>
                  <Button onClick={() => setCreatedAccount(null)} variant="secondary">
                    Close
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {detectionResult?.account && detectionResult.channel && (
            <ModelDetectionResultPanel
              account={detectionResult.account}
              channel={detectionResult.channel}
              onGoToDiscovery={onGoToDiscovery}
              platform={platformById.get((detectionResult.platformId ?? "") as PlatformId)}
              result={detectionResult}
            />
          )}

          {aliasAccount && (
            <Panel title={`Account Model Aliases / ${aliasAccount.name}`}>
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-sm font-medium text-zinc-800">Detected Models</div>
                  {availableCapabilitiesForAccount(aliasAccount.id).length === 0 ? (
                    <EmptyState message="No available detected models for this account. Run Detect Models first." />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableCapabilitiesForAccount(aliasAccount.id).map((capability) => (
                        <span
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                          key={capability.id}
                        >
                          {capability.upstreamModelName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <form
                  className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAlias();
                  }}
                >
                  <Field label="Public Model">
                    <input
                      className={inputClass}
                      onChange={(event) => setAliasForm({ ...aliasForm, publicModel: event.target.value })}
                      placeholder="codex-best"
                      value={aliasForm.publicModel}
                    />
                  </Field>
                  <Field label="Upstream Model">
                    <select
                      className={inputClass}
                      onChange={(event) => setAliasForm({ ...aliasForm, upstreamModelName: event.target.value })}
                      value={aliasForm.upstreamModelName}
                    >
                      <option value="">Select upstream</option>
                      {availableCapabilitiesForAccount(aliasAccount.id).map((capability) => (
                        <option key={capability.id} value={capability.upstreamModelName}>
                          {capability.upstreamModelName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Enabled">
                    <label className="flex h-9 items-center gap-2 text-sm text-zinc-700">
                      <input
                        checked={aliasForm.enabled}
                        onChange={(event) => setAliasForm({ ...aliasForm, enabled: event.target.checked })}
                        type="checkbox"
                      />
                      Enabled
                    </label>
                  </Field>
                  <div className="flex items-end gap-2">
                    <Button disabled={!aliasForm.publicModel || !aliasForm.upstreamModelName} type="submit">
                      Save Alias
                    </Button>
                    <Button onClick={() => setAliasAccount(null)} variant="secondary">
                      Close
                    </Button>
                  </div>
                </form>

                {aliases.length === 0 ? (
                  <EmptyState message="No aliases configured for this account." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                        <tr>
                          <th className="px-3 py-2">Public Model</th>
                          <th className="px-3 py-2">Upstream Model</th>
                          <th className="px-3 py-2">Enabled</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {aliases.map((alias) => (
                          <tr key={alias.id}>
                            <td className="px-3 py-2 font-medium text-zinc-800">{alias.publicModel}</td>
                            <td className="px-3 py-2 text-zinc-500">{alias.upstreamModelName}</td>
                            <td className="px-3 py-2">
                              <StatusPill value={alias.enabled} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button onClick={() => void updateAlias(alias, { enabled: !alias.enabled })} variant="secondary">
                                  {alias.enabled ? "Disable" : "Enable"}
                                </Button>
                                <DeleteIconButton onClick={() => void removeAlias(alias)} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {form && (
            <Panel title={form.id ? "Edit Account" : "Add Account"}>
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                {!form.id && form.platformId !== "all" && (
                  <div className="space-y-4 border-b border-zinc-200 pb-4 md:col-span-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Channel Mode</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          ["use_existing", "Use Existing Channel"],
                          ["create_new", "Create New Channel"],
                          ["auto_create", "Auto Create Default Channel"]
                        ].map(([value, label]) => (
                          <button
                            className={`h-9 rounded-md border px-3 text-sm ${
                              form.channelMode === value
                                ? "border-zinc-950 bg-zinc-950 text-white"
                                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                            }`}
                            key={value}
                            onClick={() => updateChannelMode(value as ChannelMode)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {form.channelMode === "use_existing" && (
                      <Field label="Existing Channel">
                        <select className={inputClass} onChange={(e) => updateFormChannel(e.target.value)} value={form.channelId}>
                          <option value="">Select channel</option>
                          {formChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.name}
                            </option>
                          ))}
                        </select>
                        {formChannels.length === 0 && (
                          <span className="text-xs text-amber-600">No channel exists for this platform. Use Auto Create or Create New.</span>
                        )}
                      </Field>
                    )}

                    {(form.channelMode === "create_new" || form.channelMode === "auto_create") && (
                      <div className="grid gap-4 md:grid-cols-2">
                        {formPresets.length > 0 && (
                          <Field label="Provider Preset">
                            <select className={inputClass} onChange={(e) => updateChannelPreset(e.target.value)} value={form.channelPresetId}>
                              {formPresets.map((preset) => (
                                <option key={preset.id} value={preset.id}>
                                  {preset.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        <Field label="Channel Name">
                          <input className={inputClass} onChange={(e) => setForm({ ...form, channelName: e.target.value })} value={form.channelName} />
                        </Field>
                        <Field label="Provider">
                          <input
                            className={inputClass}
                            onChange={(e) => setForm({ ...form, channelProvider: e.target.value })}
                            value={form.channelProvider}
                          />
                        </Field>
                        <Field label="Adapter Type">
                          <input
                            className={inputClass}
                            onChange={(e) => setForm({ ...form, channelAdapterType: e.target.value })}
                            value={form.channelAdapterType}
                          />
                        </Field>
                        <Field label="Protocol">
                          <input
                            className={inputClass}
                            onChange={(e) => setForm({ ...form, channelProtocol: e.target.value })}
                            value={form.channelProtocol}
                          />
                        </Field>
                        <Field label="Channel Status">
                          <select className={inputClass} onChange={(e) => setForm({ ...form, channelStatus: e.target.value })} value={form.channelStatus}>
                            <option value="enabled">enabled</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </Field>
                        <Field label="Base URL" span={2}>
                          <input
                            className={inputClass}
                            onChange={(e) => setForm({ ...form, channelBaseUrl: e.target.value })}
                            value={form.channelBaseUrl}
                          />
                        </Field>
                        <Field label="Channel Config JSON" span={2}>
                          <textarea
                            className={textareaClass}
                            onChange={(e) => setForm({ ...form, channelConfig: e.target.value })}
                            value={form.channelConfig}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}

                {(form.id || form.platformId === "all") && (
                  <Field label="Channel">
                    <select className={inputClass} onChange={(e) => updateFormChannel(e.target.value)} value={form.channelId}>
                      <option value="">Select channel</option>
                      {(formChannels.length ? formChannels : channels).map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Name">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, name: e.target.value })} value={form.name} />
                </Field>
                <Field label="Auth Type">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, authType: e.target.value })} value={form.authType} />
                </Field>
                <Field label={credentialLabel(form)}>
                  {form.loginMethodType === "json_import" ? (
                    <textarea
                      className={textareaClass}
                      onChange={(e) => setForm({ ...form, credential: e.target.value })}
                      value={form.credential}
                    />
                  ) : (
                    <input
                      className={inputClass}
                      onChange={(e) => setForm({ ...form, credential: e.target.value })}
                      type="password"
                      value={form.credential}
                    />
                  )}
                  {credentialHint && (
                    <span className={credentialHint === "Invalid JSON." ? "text-xs text-red-600" : "text-xs text-zinc-500"}>
                      {credentialHint}
                    </span>
                  )}
                </Field>
                <Field label="Proxy">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, proxy: e.target.value })} value={form.proxy} />
                </Field>
                <Field label="Tags">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, tags: e.target.value })} value={form.tags} />
                </Field>
                <Field label="Weight">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, weight: e.target.value })} value={form.weight} />
                </Field>
                <Field label="Concurrency Limit">
                  <input
                    className={inputClass}
                    onChange={(e) => setForm({ ...form, concurrencyLimit: e.target.value })}
                    value={form.concurrencyLimit}
                  />
                </Field>
                <Field label="Status">
                  <select className={inputClass} onChange={(e) => setForm({ ...form, status: e.target.value })} value={form.status}>
                    <option value="enabled">enabled</option>
                    <option value="disabled">disabled</option>
                  </select>
                </Field>
                <Field label="Health">
                  <select className={inputClass} onChange={(e) => setForm({ ...form, healthStatus: e.target.value })} value={form.healthStatus}>
                    <option value="healthy">healthy</option>
                    <option value="degraded">degraded</option>
                    <option value="disabled">disabled</option>
                  </select>
                </Field>
                <Field label="Quota Limit">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, quotaLimit: e.target.value })} value={form.quotaLimit} />
                </Field>
                <Field label="Cooldown Until">
                  <input className={inputClass} onChange={(e) => setForm({ ...form, cooldownUntil: e.target.value })} value={form.cooldownUntil} />
                </Field>
                {form.id && (
                  <>
                    <Field label="Channel Base URL" span={2}>
                      <input
                        className={inputClass}
                        onChange={(e) => setForm({ ...form, channelBaseUrl: e.target.value })}
                        value={form.channelBaseUrl}
                      />
                    </Field>
                  </>
                )}
                <div className="flex gap-2 md:col-span-2">
                  <SaveButton disabled={saving} />
                  <Button onClick={() => setForm(null)} variant="secondary">
                    Cancel
                  </Button>
                </div>
              </form>
            </Panel>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-zinc-800">{selectedPlatform ? `${selectedPlatform.name} Accounts` : "Accounts"}</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {filteredAccounts.length} account{filteredAccounts.length === 1 ? "" : "s"} shown
                </p>
              </div>
            </div>

            {filteredAccounts.length === 0 ? (
              <EmptyState message={selectedPlatform ? "No accounts for this platform yet." : "No accounts yet."} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {filteredAccounts.map((account) => {
                  const counts = accountModelCounts(account.id, capabilities);
                  const accountChannel = channelForAccount(account);
                  const accountPlatform = accountChannel ? platformById.get(channelPlatformId(accountChannel)) : undefined;
                  const identity = accountIdentity(account.credentialSummary);
                  return (
                    <article className="flex min-h-[300px] flex-col rounded-md border border-zinc-200 bg-white p-4 shadow-sm" key={account.id}>
                      <header className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <PlatformLogo label={accountPlatform?.name} platformId={accountPlatform?.id} size="md" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-base font-semibold text-zinc-950" title={account.name}>
                                {account.name}
                              </h3>
                              <StatusPill value={account.status} />
                            </div>
                            <div className="mt-1 truncate text-xs text-zinc-500" title={identity}>
                              {account.authType} | {identity}
                            </div>
                          </div>
                        </div>
                        <StatusPill value={account.healthStatus} />
                      </header>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div className="min-w-0 rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Platform</div>
                          <div className="flex min-w-0 items-center gap-2 font-medium text-zinc-900" title={accountPlatform?.name ?? "-"}>
                            <PlatformLogo label={accountPlatform?.name} platformId={accountPlatform?.id} size="xs" />
                            <span className="truncate">{accountPlatform?.name ?? "-"}</span>
                          </div>
                        </div>
                        <div className="min-w-0 rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Channel</div>
                          <div className="truncate font-medium text-zinc-900" title={channelName(account.channelId)}>
                            {channelName(account.channelId)}
                          </div>
                        </div>
                        <div className="rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Detected Models</div>
                          <div className="font-medium text-zinc-900">
                            {counts.available}/{counts.total}
                          </div>
                        </div>
                        <div className="rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Concurrency</div>
                          <div className="font-medium text-zinc-900">
                            {account.currentConcurrency}/{account.concurrencyLimit}
                          </div>
                        </div>
                        <div className="rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Gateway Tokens</div>
                          <div className="font-medium text-zinc-900">
                            {account.quotaUsed}/{account.quotaLimit ?? "none"}
                          </div>
                        </div>
                        <div className="rounded-md bg-zinc-50 p-3">
                          <div className="text-xs text-zinc-500">Last Success</div>
                          <div className="truncate font-medium text-zinc-900" title={formatDate(account.lastSuccessAt)}>
                            {formatDate(account.lastSuccessAt)}
                          </div>
                        </div>
                        <div className="rounded-md bg-zinc-50 p-3 col-span-2">
                          <div className="mb-2 text-xs text-zinc-500">Upstream Quota</div>
                          <AccountQuotaPanel
                            account={account}
                            checking={checkingQuotaId === account.id || autoCheckingQuotaIds.includes(account.id)}
                            compact
                          />
                        </div>
                      </div>

                      {account.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {account.tags.map((tag) => (
                            <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {account.lastError && (
                        <div className="mt-3 truncate rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700" title={account.lastError}>
                          {account.lastError}
                        </div>
                      )}

                      <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                        <AccountActionTags account={account} accountChannel={accountChannel} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {modelSyncDialog && modelSyncAccount && modelSyncDialog.minimized && (
        <div className="fixed bottom-4 right-4 z-[70] w-[min(26rem,calc(100vw-2rem))] rounded-md border border-zinc-200 bg-white shadow-xl">
          <button
            className="block w-full p-4 text-left hover:bg-zinc-50"
            onClick={restoreModelSyncDialog}
            type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <PlatformLogo label={modelSyncPlatform?.name} platformId={modelSyncPlatform?.id} size="xs" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-950">Sync Models</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">
                    {modelSyncAccount.name} · {modelSyncStatusText}
                  </div>
                </div>
              </div>
              <span className="shrink-0 text-xs font-medium text-zinc-500">{progressPercent}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full bg-zinc-950 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            {modelSyncProgress?.currentModel && (
              <div className="mt-2 truncate text-xs text-zinc-500" title={modelSyncProgress.currentModel}>
                {modelSyncProgress.currentModel}
              </div>
            )}
          </button>
          {modelSyncIsDone && (
            <div className="flex justify-end border-t border-zinc-100 px-3 py-2">
              <Button onClick={closeModelSyncDialog} variant="secondary">
                Close
              </Button>
            </div>
          )}
        </div>
      )}

      {modelSyncDialog && modelSyncAccount && !modelSyncDialog.minimized && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModelSyncDialog();
            }
          }}
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <PlatformLogo label={modelSyncPlatform?.name} platformId={modelSyncPlatform?.id} size="md" />
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-zinc-950">Sync Models</h2>
                  <p className="mt-1 truncate text-sm text-zinc-500">
                    {modelSyncAccount.name}
                    {modelSyncChannel ? ` / ${modelSyncPlatform?.name ?? channelPlatformId(modelSyncChannel)} / ${modelSyncChannel.name}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
                  onClick={minimizeModelSyncDialog}
                  title="Minimize"
                  type="button"
                >
                  <Minimize2 size={16} />
                </button>
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(detectingAccountId) || modelSyncDialog.loadingList}
                  onClick={closeModelSyncDialog}
                  title="Close"
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="border-b border-zinc-200 px-5 py-3">
              <div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
                {[
                  ["auto", "Auto"],
                  ["manual", "Manual"]
                ].map(([mode, label]) => (
                  <button
                    className={`h-8 rounded px-3 text-sm font-medium ${
                      modelSyncDialog.mode === mode
                        ? "bg-white text-zinc-950 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-950"
                    }`}
                    disabled={Boolean(detectingAccountId) || modelSyncDialog.loadingList}
                    key={mode}
                    onClick={() => setModelSyncDialog({ ...modelSyncDialog, mode: mode as ModelSyncMode })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(90vh-138px)] overflow-y-auto p-5">
              <div className="space-y-5">
                {modelSyncDialog.mode === "auto" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-900">Auto Sync</div>
                    </div>
                    <Button disabled={Boolean(detectingAccountId)} onClick={() => void detectModels(modelSyncAccount)}>
                      <SearchCheck size={16} />
                      {detectingAccountId === modelSyncAccount.id ? "Syncing" : "Sync & Test All"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-zinc-900">Manual Sync</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={modelSyncDialog.loadingList || Boolean(detectingAccountId)}
                          onClick={() => void fetchModelList(modelSyncAccount)}
                          variant="secondary"
                        >
                          <ListChecks size={16} />
                          {modelSyncDialog.loadingList ? "Fetching" : "Fetch Models"}
                        </Button>
                        <Button
                          disabled={selectedManualModels.length === 0 || Boolean(detectingAccountId)}
                          onClick={() => void testSelectedModels(modelSyncAccount, selectedManualModels)}
                        >
                          <Play size={16} />
                          {detectingAccountId === modelSyncAccount.id ? "Testing" : `Test Selected (${selectedManualModels.length})`}
                        </Button>
                      </div>
                    </div>

                    {(modelSyncDialog.listError || modelSyncWarnings.length > 0) && (
                      <div className="space-y-2">
                        {modelSyncDialog.listError && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                            {modelSyncDialog.listError}
                          </div>
                        )}
                        {modelSyncWarnings.map((warning) => (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700" key={warning}>
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-zinc-500">
                        {modelSyncDialog.models.length} fetched / {selectedManualModels.length} selected
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className={`${inputClass} w-56`}
                          onChange={(event) => setModelSyncDialog({ ...modelSyncDialog, search: event.target.value })}
                          placeholder="Filter models"
                          value={modelSyncDialog.search}
                        />
                        <Button
                          disabled={visibleManualModels.length === 0}
                          onClick={() => selectVisibleManualModels(visibleManualModels, true)}
                          variant="secondary"
                        >
                          <CheckSquare size={16} />
                          Select Visible
                        </Button>
                        <Button
                          disabled={visibleManualModels.length === 0}
                          onClick={() => selectVisibleManualModels(visibleManualModels, false)}
                          variant="secondary"
                        >
                          Clear Visible
                        </Button>
                      </div>
                    </div>

                    {modelSyncDialog.models.length === 0 ? (
                      <EmptyState message={modelSyncDialog.loadingList ? "Fetching upstream models..." : "No fetched models yet."} />
                    ) : visibleManualModels.length === 0 ? (
                      <EmptyState message="No models match the current filter." />
                    ) : (
                      <div className="max-h-80 overflow-y-auto rounded-md border border-zinc-200">
                        <div className="divide-y divide-zinc-100">
                          {visibleManualModels.map((model) => {
                            const checked = modelSyncDialog.selectedModelNames.includes(modelName(model));
                            return (
                              <label
                                className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 hover:bg-zinc-50"
                                key={modelName(model)}
                              >
                                <input
                                  checked={checked}
                                  className="h-4 w-4 rounded border-zinc-300 text-zinc-950"
                                  onChange={(event) => setManualModelSelected(model, event.target.checked)}
                                  type="checkbox"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-zinc-900" title={model.upstreamModelName}>
                                    {model.upstreamModelName}
                                  </span>
                                  {model.displayName && model.displayName !== model.upstreamModelName && (
                                    <span className="block truncate text-xs text-zinc-500" title={model.displayName}>
                                      {model.displayName}
                                    </span>
                                  )}
                                </span>
                                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-500">
                                  {sourceLabel(model.source)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {modelSyncProgress && (
                  <div className="space-y-4 rounded-md border border-zinc-200 p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md bg-zinc-50 p-3">
                        <div className="text-xs text-zinc-500">Total Models</div>
                        <div className="mt-1 text-lg font-semibold text-zinc-950">{progressTotal ?? "-"}</div>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-3">
                        <div className="text-xs text-zinc-500">Tested</div>
                        <div className="mt-1 text-lg font-semibold text-zinc-950">
                          {progressCompleted}
                          {progressTotal !== null && progressTotal !== undefined ? ` / ${progressTotal}` : ""}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span>{detectionProgressStatusText(modelSyncProgress.status)}</span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                        <div className="h-full bg-zinc-950 transition-all" style={{ width: `${progressPercent}%` }} />
                      </div>
                    </div>

                    <div className="rounded-md border border-zinc-200 p-3">
                      <div className="text-xs text-zinc-500">Current Model</div>
                      <div className="mt-1 break-all text-sm font-medium text-zinc-950">
                        {modelSyncProgress.currentModel ??
                          (modelSyncProgress.status === "listing"
                            ? "Waiting for upstream model list"
                            : modelSyncProgress.status === "completed"
                              ? "Completed"
                              : "-")}
                      </div>
                    </div>

                    {modelSyncProgress.error && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {modelSyncProgress.error}
                      </div>
                    )}

                    {modelSyncIsDone && (
                      <div className="flex justify-end">
                        <Button onClick={closeModelSyncDialog} variant="secondary">
                          Close
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {detailAccount && detailCounts && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDetailAccountId(null);
            }
          }}
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <PlatformLogo label={detailPlatform?.name} platformId={detailPlatform?.id} size="md" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold text-zinc-950">{detailAccount.name}</h2>
                    <StatusPill value={detailAccount.status} />
                    <StatusPill value={detailAccount.healthStatus} />
                  </div>
                  <p className="mt-1 truncate text-sm text-zinc-500">
                    {detailPlatform?.name ?? "Unknown platform"} | {detailChannel?.name ?? channelName(detailAccount.channelId)}
                  </p>
                </div>
              </div>
              <button
                aria-label="Close details"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
                onClick={() => setDetailAccountId(null)}
                title="Close"
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(90vh-76px)] overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailItem label="Account ID" value={detailAccount.id} />
                <DetailItem label="Channel ID" value={detailAccount.channelId} />
                <DetailItem label="Auth Type" value={detailAccount.authType} />
                <DetailItem label="Credential" value={detailAccount.hasCredential ? "stored" : "missing"} />
                <DetailItem label="Proxy" value={detailAccount.proxy ?? "-"} />
                <DetailItem label="Weight" value={detailAccount.weight} />
                <DetailItem label="Concurrency" value={`${detailAccount.currentConcurrency}/${detailAccount.concurrencyLimit}`} />
                <DetailItem label="Gateway Tokens" value={`${detailAccount.quotaUsed}/${detailAccount.quotaLimit ?? "none"}`} />
                <DetailItem label="Quota Checked" value={formatDate(detailAccount.quotaCheckedAt)} />
                <DetailItem label="Detected Models" value={`${detailCounts.available}/${detailCounts.total} available`} />
                <DetailItem label="Cooldown Until" value={formatDate(detailAccount.cooldownUntil)} />
                <DetailItem label="Last Success" value={formatDate(detailAccount.lastSuccessAt)} />
                <DetailItem label="Last Failure" value={formatDate(detailAccount.lastFailureAt)} />
                <DetailItem label="Created" value={formatDate(detailAccount.createdAt)} />
                <DetailItem label="Updated" value={formatDate(detailAccount.updatedAt)} />
                <DetailItem label="Tags" value={detailAccount.tags.join(", ") || "-"} />
                <DetailItem
                  label="Upstream Quota"
                  span
                  value={
                    <AccountQuotaPanel
                      account={detailAccount}
                      checking={checkingQuotaId === detailAccount.id || autoCheckingQuotaIds.includes(detailAccount.id)}
                    />
                  }
                />
                <DetailItem label="Last Error" span value={detailAccount.lastError ?? "-"} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-zinc-200 p-4">
                  <h3 className="text-sm font-medium text-zinc-900">Credential Summary</h3>
                  <p className="mt-2 break-words text-sm text-zinc-600">{credentialSummaryText(detailAccount.credentialSummary)}</p>
                  {detailAccount.credentialSummary?.scopes?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {detailAccount.credentialSummary.scopes.map((scope) => (
                        <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600" key={scope}>
                          {scope}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-md border border-zinc-200 p-4">
                  <h3 className="text-sm font-medium text-zinc-900">Channel</h3>
                  {detailChannel ? (
                    <div className="mt-3 grid gap-2 text-sm text-zinc-600">
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Name</span>
                        <span className="min-w-0 truncate text-right text-zinc-900">{detailChannel.name}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Provider</span>
                        <span className="min-w-0 truncate text-right text-zinc-900">{detailChannel.provider}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Adapter</span>
                        <span className="min-w-0 truncate text-right text-zinc-900">{detailChannel.adapterType}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Protocol</span>
                        <span className="min-w-0 truncate text-right text-zinc-900">{detailChannel.protocol}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Base URL</span>
                        <span className="min-w-0 truncate text-right text-zinc-900">{detailChannel.baseUrl ?? "-"}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-zinc-500">Status</span>
                        <StatusPill value={detailChannel.status} />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">Channel information is unavailable.</p>
                  )}
                </div>
              </div>

              {detailChannel && (
                <div className="mt-5 rounded-md border border-zinc-200 p-4">
                  <h3 className="text-sm font-medium text-zinc-900">Channel Config</h3>
                  <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
                    {asJsonText(detailChannel.config)}
                  </pre>
                </div>
              )}

              <div className="mt-5 rounded-md border border-zinc-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-zinc-900">Detected Models</h3>
                  <span className="text-xs text-zinc-500">
                    {detailCounts.available}/{detailCounts.total} available
                  </span>
                </div>
                {detailCapabilities.length === 0 ? (
                  <div className="mt-3 rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                    No detected models yet.
                  </div>
                ) : (
                  <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-zinc-100">
                    {detailCapabilities.map((capability) => (
                      <div className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]" key={capability.id}>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-900" title={capability.upstreamModelName}>
                            {capability.upstreamModelName}
                          </div>
                          <div className="truncate text-xs text-zinc-500" title={capability.displayName ?? capability.source}>
                            {capability.displayName ?? capability.source}
                          </div>
                        </div>
                        <StatusPill value={capability.status} />
                        <div className="text-xs text-zinc-500 sm:text-right">
                          <div>{formatDate(capability.lastCheckedAt)}</div>
                          {capability.latencyMs !== null && <div>{capability.latencyMs} ms</div>}
                        </div>
                        {capability.lastError && (
                          <div className="truncate rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-3" title={capability.lastError}>
                            {capability.lastError}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                <AccountActionTags account={detailAccount} accountChannel={detailChannel} showDetails={false} />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
