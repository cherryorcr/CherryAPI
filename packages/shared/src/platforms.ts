import type { AdapterCapabilities } from "./types";

export type PlatformId =
  | "antigravity"
  | "codex"
  | "zed"
  | "github_copilot"
  | "windsurf"
  | "kiro"
  | "cursor"
  | "gemini_cli"
  | "codebuddy"
  | "codebuddy_cn"
  | "qoder"
  | "trae"
  | "openai"
  | "claude"
  | "openai_compatible";

export type PlatformImplementationStatus = "available" | "partial" | "planned";

export type LoginMethodType =
  | "oauth"
  | "refresh_token"
  | "json_import"
  | "local_import"
  | "plugin_sync"
  | "api_key"
  | "manual_token";

export interface LoginMethodFieldDefinition {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "json";
  required: boolean;
}

export interface LoginMethodDefinition {
  id: string;
  label: string;
  type: LoginMethodType;
  description?: string;
  implemented: boolean;
  requiredFields?: LoginMethodFieldDefinition[];
}

export interface PlatformDefinition {
  id: PlatformId;
  name: string;
  description?: string;
  channelProvider: string;
  defaultAdapterType: string;
  defaultProtocol: string;
  implementationStatus: PlatformImplementationStatus;
  supportedLoginMethods: LoginMethodDefinition[];
  supportsModelDetection: boolean;
  supportsQuota: boolean;
  supportsLocalImport: boolean;
  supportsOAuth: boolean;
  supportsJsonImport: boolean;
  defaultChannelTemplate?: ChannelTemplateDefinition;
  channelPresets?: ChannelPresetDefinition[];
}

export interface ChannelTemplateDefinition {
  name: string;
  provider: string;
  adapterType: string;
  protocol: string;
  baseUrl: string | null;
  status?: "enabled" | "disabled";
  capabilities?: Partial<AdapterCapabilities> & Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface ChannelPresetDefinition {
  id: string;
  label: string;
  description?: string;
  channel: Partial<ChannelTemplateDefinition>;
}

export interface PlatformChannelLike {
  provider?: string | null;
  adapterType?: string | null;
  adapter_type?: string | null;
  protocol?: string | null;
  name?: string | null;
}

const apiKeyField: LoginMethodFieldDefinition = {
  key: "credential",
  label: "API Key",
  type: "password",
  required: true
};

const jsonCredentialField: LoginMethodFieldDefinition = {
  key: "credential",
  label: "Credential JSON",
  type: "json",
  required: true
};

const accessTokenField: LoginMethodFieldDefinition = {
  key: "credential",
  label: "Access Token",
  type: "password",
  required: true
};

const refreshTokenField: LoginMethodFieldDefinition = {
  key: "credential",
  label: "Refresh Token",
  type: "password",
  required: true
};

const chatStreamingCapabilities = {
  chatCompletions: true,
  streaming: true,
  tools: true,
  responses: false
};

const codexCapabilities = {
  chatCompletions: true,
  streaming: true,
  tools: false,
  responses: true
};

const githubCopilotCapabilities = {
  chatCompletions: true,
  streaming: true,
  tools: true,
  responses: false
};

const claudeCapabilities = {
  chatCompletions: true,
  streaming: true,
  tools: false,
  responses: false
};

export const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    id: "antigravity",
    name: "Antigravity",
    description: "Google Antigravity account management and future plugin sync entry.",
    channelProvider: "antigravity",
    defaultAdapterType: "antigravity",
    defaultProtocol: "antigravity_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: false,
    supportsLocalImport: false,
    supportsOAuth: true,
    supportsJsonImport: false,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "refresh_token",
        label: "Refresh Token",
        type: "refresh_token",
        implemented: false,
        requiredFields: [refreshTokenField]
      },
      { id: "plugin_sync", label: "Plugin Sync", type: "plugin_sync", implemented: false }
    ]
  },
  {
    id: "codex",
    name: "Codex",
    description: "Codex accounts backed by OAuth JSON or access token credentials.",
    channelProvider: "openai",
    defaultAdapterType: "codex",
    defaultProtocol: "codex_responses_stream",
    implementationStatus: "available",
    supportsModelDetection: true,
    supportsQuota: true,
    supportsLocalImport: false,
    supportsOAuth: true,
    supportsJsonImport: true,
    defaultChannelTemplate: {
      name: "Codex",
      provider: "openai",
      adapterType: "codex",
      protocol: "codex_responses_stream",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      status: "enabled",
      capabilities: codexCapabilities,
      config: {}
    },
    supportedLoginMethods: [
      {
        id: "oauth_login",
        label: "OAuth Login",
        type: "oauth",
        description: "Open browser to sign in with ChatGPT/Codex and save OAuth credential.",
        implemented: true
      },
      {
        id: "codex_oauth_json",
        label: "OAuth JSON Import",
        type: "json_import",
        description: "Paste a Codex credential JSON containing access_token and optional account metadata.",
        implemented: true,
        requiredFields: [jsonCredentialField]
      },
      {
        id: "access_token",
        label: "Access Token",
        type: "manual_token",
        implemented: true,
        requiredFields: [accessTokenField]
      },
      { id: "local_auth_import", label: "Local Auth Import", type: "local_import", implemented: false },
    ]
  },
  {
    id: "zed",
    name: "Zed",
    description: "Zed sign-in state and JSON import entry.",
    channelProvider: "zed",
    defaultAdapterType: "zed",
    defaultProtocol: "zed_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: false,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "official_oauth", label: "Official OAuth Sign-In", type: "oauth", implemented: false },
      {
        id: "json_import",
        label: "JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_signin_state", label: "Local Sign-In State", type: "local_import", implemented: false }
    ]
  },
  {
    id: "github_copilot",
    name: "GitHub Copilot",
    description: "GitHub Copilot accounts backed by GitHub OAuth, GitHub access token, or exported Copilot credential JSON.",
    channelProvider: "github_copilot",
    defaultAdapterType: "github_copilot",
    defaultProtocol: "github_copilot_chat_completions",
    implementationStatus: "available",
    supportsModelDetection: true,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    defaultChannelTemplate: {
      name: "GitHub Copilot",
      provider: "github_copilot",
      adapterType: "github_copilot",
      protocol: "github_copilot_chat_completions",
      baseUrl: "https://api.githubcopilot.com",
      status: "enabled",
      capabilities: githubCopilotCapabilities,
      config: {}
    },
    supportedLoginMethods: [
      {
        id: "oauth_login",
        label: "OAuth Login",
        type: "oauth",
        description: "Use GitHub device authorization and save a refreshed Copilot credential.",
        implemented: true
      },
      {
        id: "github_access_token",
        label: "GitHub Access Token",
        type: "manual_token",
        description: "Paste a GitHub OAuth access token; CherryAPI will exchange it for a Copilot token.",
        implemented: true,
        requiredFields: [accessTokenField]
      },
      {
        id: "copilot_credential_json",
        label: "Credential JSON Import",
        type: "json_import",
        description: "Paste an exported GitHub Copilot credential JSON containing copilot_token.",
        implemented: true,
        requiredFields: [jsonCredentialField]
      },
      {
        id: "local_vscode_import",
        label: "Local VS Code Import",
        type: "local_import",
        description: "Import the current GitHub Copilot login from local VS Code state.",
        implemented: true
      }
    ]
  },
  {
    id: "windsurf",
    name: "Windsurf",
    channelProvider: "windsurf",
    defaultAdapterType: "windsurf",
    defaultProtocol: "windsurf_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false }
    ]
  },
  {
    id: "kiro",
    name: "Kiro",
    channelProvider: "kiro",
    defaultAdapterType: "kiro",
    defaultProtocol: "kiro_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false }
    ]
  },
  {
    id: "cursor",
    name: "Cursor",
    channelProvider: "cursor",
    defaultAdapterType: "cursor",
    defaultProtocol: "cursor_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false }
    ]
  },
  {
    id: "gemini_cli",
    name: "Gemini CLI",
    channelProvider: "google",
    defaultAdapterType: "gemini",
    defaultProtocol: "gemini_api",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false }
    ]
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    channelProvider: "codebuddy",
    defaultAdapterType: "codebuddy",
    defaultProtocol: "codebuddy_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: false,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      }
    ]
  },
  {
    id: "codebuddy_cn",
    name: "CodeBuddy CN",
    channelProvider: "codebuddy_cn",
    defaultAdapterType: "codebuddy_cn",
    defaultProtocol: "codebuddy_cn_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: true,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "oauth", label: "OAuth", type: "oauth", implemented: false },
      {
        id: "token_json_import",
        label: "Token/JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      },
      { id: "local_client_import", label: "Local Client Import", type: "local_import", implemented: false }
    ]
  },
  {
    id: "qoder",
    name: "Qoder",
    channelProvider: "qoder",
    defaultAdapterType: "qoder",
    defaultProtocol: "qoder_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: false,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false },
      {
        id: "json_import",
        label: "JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      }
    ]
  },
  {
    id: "trae",
    name: "Trae",
    channelProvider: "trae",
    defaultAdapterType: "trae",
    defaultProtocol: "trae_internal",
    implementationStatus: "planned",
    supportsModelDetection: false,
    supportsQuota: true,
    supportsLocalImport: true,
    supportsOAuth: false,
    supportsJsonImport: true,
    supportedLoginMethods: [
      { id: "local_import", label: "Local Import", type: "local_import", implemented: false },
      {
        id: "json_import",
        label: "JSON Import",
        type: "json_import",
        implemented: false,
        requiredFields: [jsonCredentialField]
      }
    ]
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI API account backed by an API key.",
    channelProvider: "openai",
    defaultAdapterType: "openai_api",
    defaultProtocol: "openai_chat_completions",
    implementationStatus: "available",
    supportsModelDetection: true,
    supportsQuota: false,
    supportsLocalImport: false,
    supportsOAuth: false,
    supportsJsonImport: false,
    defaultChannelTemplate: {
      name: "OpenAI API",
      provider: "openai",
      adapterType: "openai_api",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.openai.com/v1",
      status: "enabled",
      capabilities: { chatCompletions: true, streaming: true, tools: true, responses: true },
      config: {}
    },
    supportedLoginMethods: [
      {
        id: "api_key",
        label: "API Key",
        type: "api_key",
        implemented: true,
        requiredFields: [apiKeyField]
      }
    ]
  },
  {
    id: "claude",
    name: "Claude",
    description: "Claude API account backed by an Anthropic API key.",
    channelProvider: "anthropic",
    defaultAdapterType: "claude_api",
    defaultProtocol: "anthropic_messages",
    implementationStatus: "available",
    supportsModelDetection: true,
    supportsQuota: false,
    supportsLocalImport: false,
    supportsOAuth: false,
    supportsJsonImport: false,
    defaultChannelTemplate: {
      name: "Claude API",
      provider: "anthropic",
      adapterType: "claude_api",
      protocol: "anthropic_messages",
      baseUrl: "https://api.anthropic.com/v1",
      status: "enabled",
      capabilities: claudeCapabilities,
      config: {}
    },
    supportedLoginMethods: [
      {
        id: "api_key",
        label: "API Key",
        type: "api_key",
        implemented: true,
        requiredFields: [apiKeyField]
      }
    ]
  },
  {
    id: "openai_compatible",
    name: "OpenAI-compatible",
    description: "OpenAI-compatible endpoints such as RightCode, DeepSeek, OpenRouter, or self-hosted gateways.",
    channelProvider: "openai_compatible",
    defaultAdapterType: "openai_compatible",
    defaultProtocol: "openai_chat_completions",
    implementationStatus: "available",
    supportsModelDetection: true,
    supportsQuota: false,
    supportsLocalImport: false,
    supportsOAuth: false,
    supportsJsonImport: false,
    defaultChannelTemplate: {
      name: "OpenAI Compatible",
      provider: "openai_compatible",
      adapterType: "openai_compatible",
      protocol: "openai_chat_completions",
      baseUrl: null,
      status: "enabled",
      capabilities: chatStreamingCapabilities,
      config: {}
    },
    channelPresets: [
      {
        id: "custom",
        label: "Custom",
        description: "Editable OpenAI-compatible endpoint.",
        channel: {
          name: "OpenAI Compatible",
          provider: "openai_compatible",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: null,
          config: {}
        }
      },
      {
        id: "rightcode",
        label: "RightCode",
        channel: {
          name: "RightCode",
          provider: "rightcode",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: "https://right.codes/codex/v1",
          config: {}
        }
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        channel: {
          name: "DeepSeek",
          provider: "deepseek",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: "https://api.deepseek.com/v1",
          config: {}
        }
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        channel: {
          name: "OpenRouter",
          provider: "openrouter",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: "https://openrouter.ai/api/v1",
          config: {}
        }
      },
      {
        id: "siliconflow",
        label: "SiliconFlow",
        channel: {
          name: "SiliconFlow",
          provider: "siliconflow",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: "https://api.siliconflow.cn/v1",
          config: {}
        }
      },
      {
        id: "local_newapi",
        label: "Local NewAPI / OneAPI",
        channel: {
          name: "Local NewAPI",
          provider: "openai_compatible",
          adapterType: "openai_compatible",
          protocol: "openai_chat_completions",
          baseUrl: "http://localhost:3000/v1",
          config: {}
        }
      }
    ],
    supportedLoginMethods: [
      {
        id: "api_key",
        label: "API Key",
        type: "api_key",
        description: "Use an API key with an existing OpenAI-compatible channel and base URL.",
        implemented: true,
        requiredFields: [apiKeyField]
      }
    ]
  }
];

export const PLATFORM_BY_ID: Record<PlatformId, PlatformDefinition> = PLATFORM_DEFINITIONS.reduce(
  (result, platform) => {
    result[platform.id] = platform;
    return result;
  },
  {} as Record<PlatformId, PlatformDefinition>
);

export function getPlatformDefinition(id: string): PlatformDefinition | undefined {
  return PLATFORM_BY_ID[id as PlatformId];
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function inferPlatformIdFromChannel(channel: PlatformChannelLike): PlatformId {
  const adapterType = normalize(channel.adapterType ?? channel.adapter_type);
  const provider = normalize(channel.provider);
  const protocol = normalize(channel.protocol);
  const name = normalize(channel.name);
  const haystack = [adapterType, provider, protocol, name].join(" ");

  if (adapterType === "codex" || includesAny(haystack, [" codex", "codex_"])) return "codex";
  if (adapterType === "antigravity" || provider === "antigravity") return "antigravity";
  if (includesAny(haystack, ["github_copilot", "copilot"])) return "github_copilot";
  if (includesAny(haystack, ["windsurf"])) return "windsurf";
  if (includesAny(haystack, ["kiro"])) return "kiro";
  if (includesAny(haystack, ["cursor"])) return "cursor";
  if (adapterType === "gemini" || provider === "google" || includesAny(haystack, ["gemini"])) return "gemini_cli";
  if (includesAny(haystack, ["codebuddy_cn", "codebuddy cn"])) return "codebuddy_cn";
  if (includesAny(haystack, ["codebuddy"])) return "codebuddy";
  if (includesAny(haystack, ["qoder"])) return "qoder";
  if (includesAny(haystack, ["trae"])) return "trae";
  if (includesAny(haystack, ["zed"])) return "zed";
  if (adapterType === "claude_api" || adapterType === "claude_oauth" || provider === "anthropic") return "claude";
  if (adapterType === "openai_api" || adapterType === "chatgpt_oauth") return "openai";
  if (adapterType === "openai_compatible" || provider === "openai_compatible") return "openai_compatible";

  return "openai_compatible";
}
