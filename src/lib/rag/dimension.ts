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

  // Heuristic: well-known model dimensions
  const modelLower = model.modelId.toLowerCase();
  if (modelLower.includes("bge") || modelLower.includes("gte") || modelLower.includes("e5")) {
    return 1024;
  }
  if (modelLower.includes("large") || modelLower.includes("ada")) {
    return 1536;
  }
  if (modelLower.includes("3-large") || modelLower.includes("3-small")) {
    return modelLower.includes("3-large") ? 3072 : 1536;
  }
  if (modelLower.includes("mxbai") || modelLower.includes("nomic")) {
    return 768;
  }

  // Default: assume 768 (Ollama nomic-embed-text etc)
  return 768;
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
