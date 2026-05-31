import { db } from "@/lib/db";
import { resolveModel } from "@/lib/llm/resolve-model";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { normalizeProviderBaseUrl } from "@/lib/llm/provider-endpoints";
import { decrypt } from "@/lib/crypto";

export interface EmbedConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

export interface RagContext {
  embedModel: NonNullable<Awaited<ReturnType<typeof resolveModel>>>;
  llmModel: Awaited<ReturnType<typeof resolveModel>>;
  rerankModel: Awaited<ReturnType<typeof resolveModel>>;
  embedConfig: EmbedConfig;
  llmConfig: EmbedConfig | undefined;
  rerankConfig: EmbedConfig | undefined;
  embedDim: number;
}

export function buildEmbedConfig(model: {
  provider: { apiBaseUrl: string; apiKey: string | null };
  modelId: string;
}): EmbedConfig {
  return {
    apiBase: normalizeProviderBaseUrl(model.provider.apiBaseUrl),
    apiKey: decrypt(model.provider.apiKey || ""),
    model: model.modelId,
  };
}

export async function createRagContext(
  userId: string,
  options?: {
    requireLlm?: boolean;
    embedDimFallback?: number;
  },
): Promise<RagContext> {
  const [embedModel, llmModel, rerankModel] = await Promise.all([
    resolveModel("embedding"),
    resolveModel("writing"),
    resolveModel("rerank").catch(() => null),
  ]);

  if (!embedModel) {
    throw new Error("No embedding model configured. Add one in Model Management.");
  }

  if (options?.requireLlm && !llmModel) {
    throw new Error("No writing/LLM model configured. Add one in Model Management.");
  }

  const embedDim = await resolveEmbeddingDim(embedModel).catch(() => options?.embedDimFallback ?? 0);

  const embedConfig = buildEmbedConfig(embedModel);
  const llmConfig = llmModel?.provider.apiKey ? buildEmbedConfig(llmModel) : undefined;
  const rerankConfig = rerankModel ? buildEmbedConfig(rerankModel) : undefined;

  return {
    embedModel,
    llmModel,
    rerankModel,
    embedConfig,
    llmConfig,
    rerankConfig,
    embedDim,
  };
}
