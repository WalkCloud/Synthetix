import type { ModelProvider, ModelConfig } from "@/generated/prisma/client";

type ProviderWithModels = ModelProvider & { models: ModelConfig[] };

export interface ModelConfigDto {
  id: string;
  modelId: string;
  modelName: string;
  capabilities: string[];
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsStreaming: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  localOrCloud: string;
  isDefaultFor: string | null;
  embeddingDim: number | null;
  embeddingBatchSize: number | null;
}

export interface ProviderDto {
  id: string;
  name: string;
  providerType: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  isActive: boolean;
  models: ModelConfigDto[];
}

function toModelConfigDto(model: ModelConfig): ModelConfigDto {
  let capabilities: string[] = [];
  try {
    capabilities = JSON.parse(model.capabilities || "[]");
  } catch { /* keep default */ }

  return {
    id: model.id,
    modelId: model.modelId,
    modelName: model.modelName,
    capabilities,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsStreaming: model.supportsStreaming,
    inputPrice: model.inputPrice,
    outputPrice: model.outputPrice,
    localOrCloud: model.localOrCloud,
    isDefaultFor: model.isDefaultFor,
    embeddingDim: model.embeddingDim,
    embeddingBatchSize: model.embeddingBatchSize,
  };
}

export function toProviderDto(provider: ProviderWithModels): ProviderDto {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    apiBaseUrl: provider.apiBaseUrl,
    hasApiKey: !!provider.apiKey,
    isActive: provider.isActive,
    models: provider.models.map(toModelConfigDto),
  };
}
