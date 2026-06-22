import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAuthUser } from "@/lib/auth/session";
import { toProviderDto } from "@/lib/models/provider-dto";
import { providerCreateSchema } from "@/lib/models/provider-schema";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { invalidateResolveModelCache } from "@/lib/llm/resolve-model";
import { normalizeBaseUrl, detectEmbeddingDim } from "@/lib/llm/provider-probe";
import { lookupEmbeddingDim } from "@/lib/models/model-catalog";

/**
 * Auto-detect the embedding dimension for embedding-capable models of a freshly
 * created provider. Mirrors the probe-then-catalog-fallback flow used by the
 * Test Connection endpoint (see providers/[id]/test/route.ts) so that a newly
 * created embedding model carries an accurate dim without requiring the user
 * to click "Test Connection" afterwards.
 *
 * Failures are silent: network errors, invalid keys, or unsupported models do
 * not block creation — the model keeps whatever dim the user supplied (or null).
 */
async function autoDetectEmbeddingDims(
  provider: { id: string; apiBaseUrl: string; models: Array<{ id: string; modelId: string; capabilities: string }> },
  apiKey: string | undefined,
): Promise<void> {
  const embedModels = provider.models.filter((m) => {
    try {
      const caps = JSON.parse(m.capabilities || "[]") as string[];
      return caps.some((c) => c === "embedding" || c === "embed");
    } catch {
      return false;
    }
  });
  if (embedModels.length === 0) return;

  const baseUrl = normalizeBaseUrl(provider.apiBaseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  for (const m of embedModels) {
    try {
      const probed = await detectEmbeddingDim(baseUrl, headers, { modelId: m.modelId }, provider.apiBaseUrl);
      const dim = probed ?? (await lookupEmbeddingDim(m.modelId));
      if (dim && dim > 0) {
        await db.modelConfig.update({ where: { id: m.id }, data: { embeddingDim: dim } }).catch(() => {});
      }
    } catch {
      // Silent: keep the user-supplied dim (or null) on any failure.
    }
  }
}

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const providers = await db.modelProvider.findMany({
    where: { userId: user.id },
    include: { models: true },
    orderBy: { createdAt: "desc" },
  });

  return successResponse(providers.map(toProviderDto));
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: "invalidInput", message: "Invalid request body" }, 400);
  }

  const parsed = providerCreateSchema.safeParse(body);
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
          embeddingDim: m.embeddingDim,
        })),
      },
    },
    include: { models: true },
  });

  // Probe and persist the real embedding dimension for embedding-capable models
  // so the user does not need to click "Test Connection" after creating. Uses
  // the plaintext apiKey here (pre-encryption) to build auth headers.
  await autoDetectEmbeddingDims(provider, apiKey);

  // Re-fetch so the response reflects the detected dims written above.
  const providerWithDims = await db.modelProvider.findUnique({
    where: { id: provider.id },
    include: { models: true },
  });

  // New models may carry isDefaultFor slots that change resolveModel outcomes
  // for this user. Drop the cache so the next search resolves fresh.
  invalidateResolveModelCache(user.id);

  return successResponse(toProviderDto(providerWithDims ?? provider), 201);
}
