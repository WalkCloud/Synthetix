import { getLLMClient } from "@/lib/llm/client";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { semanticSearch } from "@/lib/search/semantic";
import {
  assembleContext,
  type ContextInput,
} from "@/lib/writing/context";

const RAG_REFERENCE_LIMIT = 20;
const GENERATION_TEMPERATURE = 0.7;

interface RagConfig {
  mode: "auto" | "manual" | "off";
  documentIds: string[];
}

async function fetchRagReferences(
  draftTitle: string,
  sectionTitle: string,
  sectionDescription: string | null | undefined,
  userId: string,
  ragConfig?: RagConfig
): Promise<ContextInput["ragReferences"]> {
  if (ragConfig?.mode === "off") {
    return [];
  }

  const queryParts = [draftTitle, sectionTitle];
  if (sectionDescription) {
    queryParts.push(sectionDescription);
  }
  const query = queryParts.join(" ");

  try {
    const results = await semanticSearch(query, userId, RAG_REFERENCE_LIMIT);
    let mapped = results.map((result) => ({
      documentId: result.documentId,
      chunkId: result.chunkId,
      documentName: result.documentName,
      title: result.title,
      content: result.content,
      score: result.score,
    }));

    if (ragConfig?.mode === "manual" && ragConfig.documentIds.length > 0) {
      const allowed = new Set(ragConfig.documentIds);
      mapped = mapped.filter((r) => r.documentId && allowed.has(r.documentId));
    }

    return mapped;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Failed to retrieve RAG references for section generation: ${message}`
    );
  }
}

export interface GenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

function parseRagConfig(section: { ragMode?: string; ragDocumentIds?: string | null }): RagConfig {
  const mode = (section.ragMode || "auto") as RagConfig["mode"];
  let documentIds: string[] = [];
  try {
    documentIds = JSON.parse(section.ragDocumentIds || "[]");
  } catch { documentIds = []; }
  return { mode, documentIds };
}

export async function generateSection(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"]
): Promise<GenerationResult> {
  const { provider, modelId, modelConfigId } = await getLLMClient("writing");

  const ragReferences = await fetchRagReferences(
    draft.title,
    section.title,
    section.description,
    userId,
    parseRagConfig(section)
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints,
  });

  try {
    const response = await provider.chat({
      model: modelId,
      messages,
      temperature: GENERATION_TEMPERATURE,
    });

    if (!response.content.trim()) {
      throw new Error(
        "Model returned empty content for section generation."
      );
    }

    await recordTokenUsage({
      userId,
      modelConfigId,
      module: "writing",
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    }).catch((err) => { console.warn("Failed to record token usage:", err); });

    return {
      content: response.content,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Section generation failed: ${message}`);
  }
}

export async function generateSectionStream(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"],
  customModelConfigId?: string
) {
  let provider: ReturnType<typeof createLLMProvider>;
  let modelId: string;
  let modelConfigId: string;

  if (customModelConfigId) {
    // Use custom model
    const { db } = await import("@/lib/db");
    const modelConfig = await db.modelConfig.findUnique({
      where: { id: customModelConfigId },
      include: { provider: true },
    });
    if (!modelConfig?.provider) {
      throw new Error(`Model config ${customModelConfigId} not found`);
    }
    provider = createLLMProvider({
      apiBaseUrl: modelConfig.provider.apiBaseUrl,
      apiKey: modelConfig.provider.apiKey,
    });
    modelId = modelConfig.modelId;
    modelConfigId = modelConfig.id;
  } else {
    // Use default writing model
    const resolved = await getLLMClient("writing");
    provider = resolved.provider;
    modelId = resolved.modelId;
    modelConfigId = resolved.modelConfigId;
  }

  const ragReferences = await fetchRagReferences(
    draft.title,
    section.title,
    section.description,
    userId,
    parseRagConfig(section)
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints,
  });

  const stream = provider.chatStream({
    model: modelId,
    messages,
    temperature: GENERATION_TEMPERATURE,
    stream: true,
  });

  return { stream, modelConfigId, ragReferences };
}

export interface ComparisonResult {
  contentA: string;
  contentB: string;
  modelA: string;
  modelB: string;
  inputTokensA: number;
  outputTokensA: number;
  inputTokensB: number;
  outputTokensB: number;
}

export async function compareSection(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  modelAConfig: { provider: unknown; modelId: string; modelConfigId?: string },
  modelBConfig: { provider: unknown; modelId: string; modelConfigId?: string },
  constraints?: ContextInput["constraints"]
): Promise<ComparisonResult> {
  const providerA = modelAConfig.provider as ReturnType<
    typeof createLLMProvider
  >;
  const providerB = modelBConfig.provider as ReturnType<
    typeof createLLMProvider
  >;

  const ragReferences = await fetchRagReferences(
    draft.title,
    section.title,
    section.description,
    userId,
    parseRagConfig(section)
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints,
  });

  const chatParams = {
    messages,
    temperature: GENERATION_TEMPERATURE,
  };

  try {
    const [responseA, responseB] = await Promise.all([
      providerA.chat({ ...chatParams, model: modelAConfig.modelId }),
      providerB.chat({ ...chatParams, model: modelBConfig.modelId }),
    ]);

    if (!responseA.content.trim()) {
      throw new Error(
        `Model A (${modelAConfig.modelId}) returned empty content.`
      );
    }
    if (!responseB.content.trim()) {
      throw new Error(
        `Model B (${modelBConfig.modelId}) returned empty content.`
      );
    }

    return {
      contentA: responseA.content,
      contentB: responseB.content,
      modelA: responseA.model,
      modelB: responseB.model,
      inputTokensA: responseA.inputTokens,
      outputTokensA: responseA.outputTokens,
      inputTokensB: responseB.inputTokens,
      outputTokensB: responseB.outputTokens,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Section comparison failed: ${message}`);
  }
}
