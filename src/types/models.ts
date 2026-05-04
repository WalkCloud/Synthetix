export type ProviderType = "ollama" | "openai_compatible" | "anthropic" | "custom";
export type LocalOrCloud = "local" | "cloud";

export interface ModelCapability {
  capability: string;
  label: string;
}

export const MODEL_CAPABILITIES: ModelCapability[] = [
  { capability: "chat", label: "对话" },
  { capability: "writing", label: "写作" },
  { capability: "embedding", label: "向量化" },
  { capability: "rerank", label: "重排序" },
  { capability: "vision", label: "视觉理解" },
  { capability: "image_generation", label: "文生图" },
  { capability: "summarization", label: "摘要" },
  { capability: "splitting", label: "文档拆分" },
];

export interface ProviderFormData {
  name: string;
  providerType: ProviderType;
  apiBaseUrl: string;
  apiKey?: string;
  models: ModelConfigFormData[];
}

export interface ModelConfigFormData {
  modelId: string;
  modelName: string;
  capabilities: string[];
  contextWindow: number;
  maxOutputTokens?: number;
  supportsStreaming: boolean;
  inputPrice?: number;
  outputPrice?: number;
  localOrCloud: LocalOrCloud;
  isDefaultFor?: string;
}
