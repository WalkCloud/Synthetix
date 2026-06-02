import { z } from "zod";

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

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: z.enum([
    "ollama",
    "openai_compatible",
    "anthropic",
    "custom",
  ]),
  apiBaseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).min(1),
});

export const providerUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  providerType: z.enum([
    "ollama",
    "openai_compatible",
    "anthropic",
    "custom",
  ]).optional(),
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).min(1).optional(),
});
