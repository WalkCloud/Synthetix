import type { ModelProvider, ModelConfig } from "@prisma/client";

type ProviderWithModels = ModelProvider & { models: ModelConfig[] };

export interface ProviderDto {
  id: string;
  name: string;
  providerType: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  isActive: boolean;
  models: ModelConfig[];
}

export function toProviderDto(provider: ProviderWithModels): ProviderDto {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    apiBaseUrl: provider.apiBaseUrl,
    hasApiKey: !!provider.apiKey,
    isActive: provider.isActive,
    models: provider.models,
  };
}
