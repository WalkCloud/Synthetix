import { decrypt } from "@/lib/crypto";
import { OpenAICompatibleAdapter } from "./adapter";
import { AnthropicAdapter } from "./anthropic-adapter";
import type { LLMProvider } from "./types";

interface ProviderConfig {
  apiBaseUrl: string;
  apiKey?: string | null;
  /**
   * Provider protocol discriminator. "anthropic" routes to the Anthropic
   * Messages API adapter; everything else (openai_compatible, ollama) uses
   * the OpenAI-compatible adapter. Optional for backward compatibility.
   */
  providerType?: string;
}

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  const apiKey = config.apiKey ? decrypt(config.apiKey) : undefined;

  if (config.providerType === "anthropic") {
    return new AnthropicAdapter({ baseUrl: config.apiBaseUrl, apiKey });
  }
  return new OpenAICompatibleAdapter({ baseUrl: config.apiBaseUrl, apiKey });
}
