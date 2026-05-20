import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const providers = await db.modelProvider.findMany({
    where: { userId: user.id },
    include: { models: true },
    orderBy: { createdAt: "desc" },
  });

  return successResponse(providers);
}

const modelConfigSchema = z.object({
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

const providerSchema = z.object({
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

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const body = await request.json();
  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { name, providerType, apiBaseUrl, apiKey, models } = parsed.data;

  const provider = await db.modelProvider.create({
    data: {
      userId: user.id,
      name,
      providerType,
      apiBaseUrl,
      apiKey: apiKey ? encrypt(apiKey) : null,
      models: {
        create: models.map((m) => ({
          modelId: m.modelId,
          modelName: m.modelName,
          capabilities: JSON.stringify(m.capabilities),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          supportsStreaming: m.supportsStreaming,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
          localOrCloud: m.localOrCloud,
          isDefaultFor: m.isDefaultFor,
          embeddingBatchSize: m.embeddingBatchSize,
        })),
      },
    },
    include: { models: true },
  });

  return successResponse(provider, 201);
}
