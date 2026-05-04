import { decrypt } from "@/lib/crypto";
import { OpenAICompatibleAdapter } from "./adapter";
import type { LLMProvider } from "./types";

interface ProviderConfig {
  apiBaseUrl: string;
  apiKey?: string | null;
}

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  return new OpenAICompatibleAdapter({
    baseUrl: config.apiBaseUrl,
    apiKey: config.apiKey ? decrypt(config.apiKey) : undefined,
  });
}
