export interface ModelConfig {
  id: string;
  modelId: string;
  modelName: string;
  capabilities: string;
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

export interface Provider {
  id: string;
  name: string;
  providerType: string;
  apiBaseUrl: string;
  apiKey?: string | null;
  isActive: boolean;
  models: ModelConfig[];
}

export interface UsageEntry {
  id: string;
  module: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  modelName: string | null;
  providerName: string | null;
}

export interface ModelUsageAggregate {
  modelConfigId: string;
  modelName: string;
  providerName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

export interface ModuleUsageAggregate {
  module: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  modelsUsed: number;
}

export interface UsageData {
  entries: UsageEntry[];
  byModel: ModelUsageAggregate[];
  byModule: ModuleUsageAggregate[];
  summary: UsageSummary;
}
