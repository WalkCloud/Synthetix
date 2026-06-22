import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import type { ModelProvider, ModelConfig } from "@/generated/prisma/client";

type ModelWithProvider = ModelConfig & { provider: ModelProvider };

/**
 * Auto-detect embedding dimension by calling the embedding API with a short text.
 * Caches the result in ModelConfig.embeddingDim to avoid repeated API calls.
 * Returns the dimension, and sets lightragCompatible = false if probing fails.
 *
 * The probe call still consumes provider tokens, so we record it under the
 * "embedding" module — otherwise these calls were silently invisible on the
 * Token Usage Analytics page.
 */
export async function resolveEmbeddingDim(model: ModelWithProvider): Promise<number> {
  if (model.embeddingDim && model.embeddingDim > 0) {
    return model.embeddingDim;
  }

  try {
    const provider = createLLMProvider(model.provider);
    const result = await provider.embed(["dimension probe"], model.modelId);
    const dim = result.embeddings[0]?.length;
    if (dim && dim > 0) {
      await db.modelConfig.update({
        where: { id: model.id },
        data: { embeddingDim: dim },
      }).catch(() => {});
      await recordTokenUsageSafely({
        userId: model.provider.userId,
        modelConfigId: model.id,
        module: "embedding",
        inputTokens: result.inputTokens ?? 0,
        outputTokens: 0,
      });
      return dim;
    }
  } catch {}

  throw new Error(
    `Cannot determine embedding dimension for "${model.modelId}". ` +
    `Click "Test Connection" in Model Management to auto-detect it.`
  );
}

/**
 * Check if the embedding model is verified compatible with LightRAG graph mode.
 * LightRAG internally expects 1536-dimensional vectors for entity extraction.
 * Models with smaller dimensions (768, 1024) will fail graph extraction.
 */
export function isLightRAGCompatible(model: { embeddingDim?: number | null }): boolean {
  const dim = model.embeddingDim ?? 0;
  // Only verified dimensions >= 1536 are LightRAG graph-mode compatible
  return dim >= 1536;
}

/**
 * Minimum embedding dimension LightRAG requires for knowledge-graph entity
 * extraction. Exposed so UI/backend share one source of truth instead of the
 * magic 1536 being copy-pasted across layers.
 */
export const LIGHTRAG_MIN_DIM = 1536;

export interface GraphDowngradeResult {
  /** Final index mode after applying any necessary downgrade. */
  indexMode: "basic" | "graph";
  /** Whether a graph→basic downgrade happened (caller should warn the user). */
  downgraded: boolean;
}

/**
 * Decide whether a "graph" indexMode must be downgraded to "basic" because the
 * embedding model's dimension is below the LightRAG minimum. Pure: no I/O, no
 * side effects — the caller persists any warning. Centralizing this here keeps
 * the downgrade rule identical across the pipeline and any future call sites.
 */
export function resolveGraphDowngrade(
  requestedMode: "basic" | "graph",
  model: { modelId: string; embeddingDim?: number | null },
): GraphDowngradeResult {
  if (requestedMode !== "graph") {
    return { indexMode: requestedMode, downgraded: false };
  }
  if (isLightRAGCompatible(model)) {
    return { indexMode: "graph", downgraded: false };
  }
  return { indexMode: "basic", downgraded: true };
}

/**
 * Human-readable message for a graph→basic downgrade, shown to the user via
 * the document's conversionWarning field so the empty knowledge graph has an
 * explanation instead of looking like a silent success.
 */
export function graphDowngradeWarning(model: { modelId: string; embeddingDim?: number | null }): string {
  const dim = model.embeddingDim ?? 0;
  return `Knowledge graph disabled: embedding model "${model.modelId}" dimension (${dim > 0 ? dim : "unknown"}) is below the ${LIGHTRAG_MIN_DIM} minimum. Re-index after switching to a higher-dimension embedding model.`;
}
