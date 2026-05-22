import type { ChannelTemplateDefinition, LoginMethodDefinition, PlatformId } from "@cherryapi/shared";
import type {
  AccountModelDetectionProgress,
  AccountRecord,
  ChannelRecord,
  DetectedAccountModel,
  PlatformRecord
} from "../../types/admin";

export type PlatformSelection = PlatformId | "all";
export type ChannelMode = "use_existing" | "create_new" | "auto_create";

export interface AccountFormState {
  id?: string;
  platformId: PlatformSelection;
  loginMethodId?: string;
  loginMethodType?: LoginMethodDefinition["type"];
  channelMode: ChannelMode;
  channelPresetId: string;
  channelId: string;
  channelName: string;
  channelProvider: string;
  channelAdapterType: string;
  channelProtocol: string;
  channelStatus: string;
  name: string;
  authType: string;
  credential: string;
  proxy: string;
  tags: string;
  weight: string;
  concurrencyLimit: string;
  status: string;
  healthStatus: string;
  quotaLimit: string;
  cooldownUntil: string;
  channelBaseUrl: string;
  candidateModels: string;
  channelConfig: string;
}

export interface ChannelFormState {
  id?: string;
  platformId: PlatformId;
  name: string;
  provider: string;
  adapterType: string;
  protocol: string;
  baseUrl: string;
  status: string;
  candidateModels: string;
  config: string;
}

export interface CreatedAccountState {
  account: AccountRecord;
  channel: ChannelRecord;
  platform?: PlatformRecord;
}

export type ModelSyncMode = "auto" | "manual";

export interface ModelSyncDialogState {
  accountId: string;
  mode: ModelSyncMode;
  minimized: boolean;
  models: DetectedAccountModel[];
  selectedModelNames: string[];
  search: string;
  loadingList: boolean;
  listError: string | null;
  warnings: string[];
}

export interface CodexOAuthState {
  step: "setup" | "authorize";
  accountName: string;
  tags: string;
  channelMode: ChannelMode;
  channelId: string;
  sessionId: string;
  expiresAt: string | null;
  instructions: string | null;
  authUrl: string | null;
  credential: string;
  status: string;
  completionStarted: boolean;
  authWindowOpened: boolean;
}

export interface GitHubCopilotOAuthState {
  step: "setup" | "authorize";
  accountName: string;
  tags: string;
  channelMode: ChannelMode;
  channelId: string;
  sessionId: string;
  expiresAt: string | null;
  instructions: string | null;
  authUrl: string | null;
  verificationUri: string | null;
  verificationUriComplete: string | null;
  userCode: string | null;
  credential: string;
  status: string;
  completionStarted: boolean;
  authWindowOpened: boolean;
}

export interface GitHubCopilotLocalImportState {
  accountName: string;
  tags: string;
  channelMode: ChannelMode;
  channelId: string;
  userDataDir: string;
}

export type AccountDetectionProgressFactory = (
  account: AccountRecord,
  requestId: string
) => AccountModelDetectionProgress;

export type AccountChannelTemplateFactory = (
  form: AccountFormState,
  template?: ChannelTemplateDefinition
) => AccountFormState;
