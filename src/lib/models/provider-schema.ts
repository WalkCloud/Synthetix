import { z } from "zod";
import { providerTypeValues } from "./provider-types";

export const modelConfigSchema = z.object({
  modelId: z.string().min(1),
  modelName: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  contextWindow: z.number().int().min(0).default(0),
  maxOutputTokens: z.number().int().optional(),
  supportsStreaming: z.boolean().default(true),
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
  localOrCloud: z.enum(["local", "cloud"]).default("local"),
  isDefaultFor: z.string().optional(),
  embeddingBatchSize: z.number().int().min(1).max(1000).optional(),
  embeddingDim: z.number().int().min(1).optional(),
});

function hasNonLlmCapability(capabilities: string[]): boolean {
  return capabilities.some((capability) =>
    capability === "embedding" ||
    capability === "embed" ||
    capability === "rerank" ||
    capability === "image_generation"
  );
}

function validateProviderTypeForModels(
  providerType: string | undefined,
  models: Array<{ capabilities: string[] }> | undefined,
  ctx: z.core.$RefinementCtx,
): void {
  if (!providerType || !models) return;
  if (providerType !== "anthropic") return;
  if (!models.some((model) => hasNonLlmCapability(model.capabilities))) return;

  ctx.addIssue({
    code: "custom",
    path: ["providerType"],
    message: "Anthropic provider type is only available for LLM models.",
  });
}

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: z.enum(providerTypeValues),
  apiBaseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).min(1),
}).superRefine((data, ctx) => {
  validateProviderTypeForModels(data.providerType, data.models, ctx);
});

export const providerUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  providerType: z.enum(providerTypeValues).optional(),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).min(1).optional(),
}).superRefine((data, ctx) => {
  validateProviderTypeForModels(data.providerType, data.models, ctx);
});
