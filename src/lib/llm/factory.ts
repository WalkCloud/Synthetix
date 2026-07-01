import { decrypt } from "@/lib/crypto";
import { OpenAICompatibleAdapter } from "./adapter";
import { AnthropicAdapter } from "./anthropic-adapter";
import { normalizeProviderBaseUrl } from "./provider-endpoints";
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

/**
 * Compute the per-provider key used to bucket adaptive-limiter state. Two
 * adapters that talk to the same endpoint share one limiter instance, because
 * the provider's rate limit is shared across all callers. Different endpoints
 * get separate limiters so a weak provider can't drag down a strong one.
 *
 * Exported so workers (and tests) can predict the key without constructing
 * an adapter.
 */
export function providerKeyFor(providerType: string | undefined, apiBaseUrl: string): string {
  const type = providerType ?? "openai_compatible";
  return `${type}:${normalizeProviderBaseUrl(apiBaseUrl)}`;
}

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  const apiKey = config.apiKey ? decrypt(config.apiKey) : undefined;
  const providerKey = providerKeyFor(config.providerType, config.apiBaseUrl);

  if (config.providerType === "anthropic") {
    return new AnthropicAdapter({ baseUrl: config.apiBaseUrl, apiKey, providerKey });
  }
  return new OpenAICompatibleAdapter({ baseUrl: config.apiBaseUrl, apiKey, providerKey });
}
