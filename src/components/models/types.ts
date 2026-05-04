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
  costEstimate: number | null;
  createdAt: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCalls: number;
}
