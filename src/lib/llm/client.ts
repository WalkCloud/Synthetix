import { createLLMProvider } from "./factory";
import { resolveModel } from "./resolve-model";
import type { LLMProvider } from "./types";

export interface LLMClient {
  provider: LLMProvider;
  modelId: string;
  modelConfigId: string;
}

export async function resolveLLMClient(
  capability: string,
  userId?: string
): Promise<LLMClient | null> {
  const model = await resolveModel(capability, userId);
  if (!model?.provider) return null;

  return {
    provider: createLLMProvider({
      apiBaseUrl: model.provider.apiBaseUrl,
      apiKey: model.provider.apiKey,
    }),
    modelId: model.modelId,
    modelConfigId: model.id,
  };
}

export async function getLLMClient(capability: string, userId?: string): Promise<LLMClient> {
  const client = await resolveLLMClient(capability, userId);
  if (!client) {
    throw new Error(
      `No ${capability} model configured. Add one in Settings → Model Management.`
    );
  }
  return client;
}
