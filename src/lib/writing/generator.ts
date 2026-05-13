import { createLLMProvider } from "@/lib/llm/factory";
import { resolveModel } from "@/lib/llm/resolve-model";
import { recordTokenUsage } from "@/lib/llm/usage";
import { semanticSearch } from "@/lib/search/semantic";
import {
  assembleContext,
  type ContextInput,
} from "@/lib/writing/context";

const RAG_REFERENCE_LIMIT = 20;
const GENERATION_TEMPERATURE = 0.7;

interface ModelResolution {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
}

async function resolveDefaultWritingModel(): Promise<ModelResolution> {
  const writingModel = await resolveModel("writing");

  if (writingModel?.provider) {
    return {
      provider: createLLMProvider({
        apiBaseUrl: writingModel.provider.apiBaseUrl,
        apiKey: writingModel.provider.apiKey,
      }),
      modelId: writingModel.modelId,
      modelConfigId: writingModel.id,
    };
  }

  throw new Error(
    "No writing model configured. Set a default writing model or add a chat-capable model in settings."
  );
}

async function fetchRagReferences(
  draftTitle: string,
  sectionTitle: string,
  sectionDescription: string | null | undefined,
  userId: string
): Promise<ContextInput["ragReferences"]> {
  const queryParts = [draftTitle, sectionTitle];
  if (sectionDescription) {
    queryParts.push(sectionDescription);
  }
  const query = queryParts.join(" ");

  try {
    const results = await semanticSearch(query, userId, RAG_REFERENCE_LIMIT);
    return results.map((result) => ({
      documentId: result.documentId,
      chunkId: result.chunkId,
      documentName: result.documentName,
      title: result.title,
      content: result.content,
      score: result.score,
    }));
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

export async function generateSection(
  draft: ContextInput["draft"],
  section: ContextInput["section"],
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"]
): Promise<GenerationResult> {
  const { provider, modelId, modelConfigId } = await resolveDefaultWritingModel();

  const ragReferences = await fetchRagReferences(
    draft.title,
    section.title,
    section.description,
    userId
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
    }).catch(() => {});

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
  section: ContextInput["section"],
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"]
) {
  const { provider, modelId, modelConfigId } = await resolveDefaultWritingModel();

  const ragReferences = await fetchRagReferences(
    draft.title,
    section.title,
    section.description,
    userId
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
  section: ContextInput["section"],
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
    userId
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
