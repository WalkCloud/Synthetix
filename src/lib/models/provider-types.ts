export type ModelProviderSlot = "llm" | "embedding" | "rerank" | "image";
export type ModelProviderType = "ollama" | "openai_compatible" | "anthropic";

export interface ProviderTypeOption {
  value: ModelProviderType;
  label: string;
}

const PROVIDER_TYPE_OPTIONS: ProviderTypeOption[] = [
  { value: "openai_compatible", label: "OpenAI Standard API (Recommended)" },
  { value: "anthropic", label: "Anthropic" },
  { value: "ollama", label: "Ollama" },
];

export const providerTypeValues = PROVIDER_TYPE_OPTIONS.map((option) => option.value) as [
  ModelProviderType,
  ...ModelProviderType[],
];

export function getProviderTypeOptions(slot: ModelProviderSlot): ProviderTypeOption[] {
  if (slot === "llm") return PROVIDER_TYPE_OPTIONS;
  return PROVIDER_TYPE_OPTIONS.filter((option) => option.value !== "anthropic");
}

export function isLocalProviderType(providerType: string): boolean {
  return providerType === "ollama";
}
