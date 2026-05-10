import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { decrypt } from "@/lib/crypto";
import type { ModelProvider, ModelConfig } from "@/generated/prisma/client";

type ModelWithProvider = ModelConfig & { provider: ModelProvider };

/**
 * Auto-detect embedding dimension by calling the embedding API with a short text.
 * Caches the result in ModelConfig.embeddingDim to avoid repeated API calls.
 */
export async function resolveEmbeddingDim(model: ModelWithProvider): Promise<number> {
  // Return cached dimension if already known
  if (model.embeddingDim && model.embeddingDim > 0) {
    return model.embeddingDim;
  }

  try {
    const provider = createLLMProvider(model.provider);
    const result = await provider.embed(["dimension probe"], model.modelId);
    const dim = result.embeddings[0]?.length;
    if (dim && dim > 0) {
      // Cache in DB for future calls
      await db.modelConfig.update({
        where: { id: model.id },
        data: { embeddingDim: dim },
      }).catch(() => {}); // non-critical
      return dim;
    }
  } catch {
    // Probe failed — fall through to heuristics
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
