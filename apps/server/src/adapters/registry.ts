import { AntigravityAdapter } from "./antigravity.adapter";
import { ClaudeAdapter } from "./claude.adapter";
import { CodexAdapter } from "./codex.adapter";
import { GeminiAdapter } from "./gemini.adapter";
import { GitHubCopilotAdapter } from "./github-copilot.adapter";
import { OpenAIApiAdapter } from "./openai-api.adapter";
import { OpenAICompatibleAdapter } from "./openai-compatible.adapter";
import type { ProviderAdapter } from "./types";

export class AdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor() {
    this.register(new OpenAICompatibleAdapter());
    this.register(new OpenAIApiAdapter());
    this.register(new ClaudeAdapter("claude_api"));
    this.register(new ClaudeAdapter("claude_oauth"));
    this.register(new CodexAdapter());
    this.register(new GitHubCopilotAdapter());
    this.register(new GeminiAdapter());
    this.register(new AntigravityAdapter());
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): ProviderAdapter | undefined {
    return this.adapters.get(type);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

export const adapterRegistry = new AdapterRegistry();
