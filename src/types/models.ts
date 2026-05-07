export type ProviderType = "ollama" | "openai_compatible" | "anthropic" | "custom";
export type LocalOrCloud = "local" | "cloud";

export interface ModelCapability {
  capability: string;
  label: string;
}

export const MODEL_CAPABILITIES: ModelCapability[] = [
  { capability: "chat", label: "Chat" },
  { capability: "writing", label: "Writing" },
  { capability: "embedding", label: "Embedding" },
  { capability: "rerank", label: "Rerank" },
  { capability: "vision", label: "Vision" },
  { capability: "image_generation", label: "Image Gen" },
  { capability: "summarization", label: "Summarization" },
  { capability: "splitting", label: "Splitting" },
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
