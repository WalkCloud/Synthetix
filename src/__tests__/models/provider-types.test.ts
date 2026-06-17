import { describe, expect, it } from "vitest";

import { providerCreateSchema } from "@/lib/models/provider-schema";
import { getProviderTypeOptions } from "@/lib/models/provider-types";

const baseModel = {
  modelId: "test-model",
  modelName: "Test Model",
  capabilities: ["chat"],
  contextWindow: 8192,
};

function payload(providerType: string, capabilities: string[]) {
  return {
    name: "Test Provider",
    providerType,
    apiBaseUrl: "https://api.example.com/v1",
    models: [{ ...baseModel, capabilities }],
  };
}

describe("model provider type restrictions", () => {
  it("does not offer custom provider type for any model management tab", () => {
    expect(getProviderTypeOptions("llm").map((option) => option.value)).toEqual([
      "openai_compatible",
      "anthropic",
      "ollama",
    ]);
    expect(getProviderTypeOptions("embedding").map((option) => option.value)).toEqual([
      "openai_compatible",
      "ollama",
    ]);
    expect(getProviderTypeOptions("rerank").map((option) => option.value)).toEqual([
      "openai_compatible",
      "ollama",
    ]);
    expect(getProviderTypeOptions("image").map((option) => option.value)).toEqual([
      "openai_compatible",
      "ollama",
    ]);
  });

  it("marks the OpenAI standard interface as the recommended default option", () => {
    for (const slot of ["llm", "embedding", "rerank", "image"] as const) {
      const [first] = getProviderTypeOptions(slot);
      expect(first).toMatchObject({
        value: "openai_compatible",
        label: "OpenAI Standard API (Recommended)",
      });
    }
  });

  it("rejects custom providers for LLM models", () => {
    expect(providerCreateSchema.safeParse(payload("custom", ["chat"])).success).toBe(false);
  });

  it.each([
    ["embedding", ["embedding"]],
    ["rerank", ["rerank"]],
    ["image", ["image_generation"]],
  ])("only accepts Ollama or OpenAI-compatible providers for %s models", (_slot, capabilities) => {
    expect(providerCreateSchema.safeParse(payload("ollama", capabilities)).success).toBe(true);
    expect(providerCreateSchema.safeParse(payload("openai_compatible", capabilities)).success).toBe(true);
    expect(providerCreateSchema.safeParse(payload("anthropic", capabilities)).success).toBe(false);
    expect(providerCreateSchema.safeParse(payload("custom", capabilities)).success).toBe(false);
  });
});
