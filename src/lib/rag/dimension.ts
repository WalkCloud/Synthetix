import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import type { ModelProvider, ModelConfig } from "@/generated/prisma/client";

type ModelWithProvider = ModelConfig & { provider: ModelProvider };

/**
 * Auto-detect embedding dimension by calling the embedding API with a short text.
 * Caches the result in ModelConfig.embeddingDim to avoid repeated API calls.
 * Returns the dimension, and sets lightragCompatible = false if probing fails.
 */
export async function resolveEmbeddingDim(model: ModelWithProvider): Promise<number> {
  // Return cached dimension if already known
  if (model.embeddingDim && model.embeddingDim > 0) {
    return model.embeddingDim;
  }

  try {
    const provider = createLLMProvider(model.provider);

    // Try 1536 first — LightRAG graph mode requires this dimension
    try {
      const result1536 = await provider.embed(["dimension probe"], model.modelId, 1536);
      const dim1536 = result1536.embeddings[0]?.length;
      if (dim1536 === 1536) {
        await db.modelConfig.update({
          where: { id: model.id },
          data: { embeddingDim: 1536 },
        }).catch(() => {});
        return 1536;
      }
    } catch {
      // 1536 not supported, fall through to auto-detect
    }

    // Auto-detect default dimension
    const result = await provider.embed(["dimension probe"], model.modelId);
    const dim = result.embeddings[0]?.length;
    if (dim && dim > 0) {
      await db.modelConfig.update({
        where: { id: model.id },
        data: { embeddingDim: dim },
      }).catch((err) => { console.warn("Failed to cache embedding dim:", err); });
      return dim;
    }
  } catch {
    // Probe failed — fall through to heuristics, mark as potentially incompatible
    await db.modelConfig.update({
      where: { id: model.id },
      data: { embeddingDim: 0 },
    }).catch(() => {});
  }

  // Heuristic: well-known model dimensions (fallback when probe fails)
  const modelLower = model.modelId.toLowerCase();
  if (modelLower.includes("bge") || modelLower.includes("gte") || modelLower.includes("e5")) {
    console.warn(`[dimension] Probe failed for ${model.modelId}, using heuristic: 1024`);
    return 1024;
  }
  if (modelLower.includes("large") || modelLower.includes("ada")) {
    console.warn(`[dimension] Probe failed for ${model.modelId}, using heuristic: 1536`);
    return 1536;
  }
  if (modelLower.includes("3-large") || modelLower.includes("3-small")) {
    const dim = modelLower.includes("3-large") ? 3072 : 1536;
    console.warn(`[dimension] Probe failed for ${model.modelId}, using heuristic: ${dim}`);
    return dim;
  }
  if (modelLower.includes("mxbai") || modelLower.includes("nomic")) {
    console.warn(`[dimension] Probe failed for ${model.modelId}, using heuristic: 768`);
    return 768;
  }

  throw new Error(
    `Cannot determine embedding dimension for model "${model.modelId}". ` +
    `API probe failed and no heuristic matches. ` +
    `Please test the model in Model Management to auto-detect its dimension, ` +
    `or save the model with the correct embedding dimension manually.`
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
