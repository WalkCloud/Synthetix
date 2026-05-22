import { getLLMClient } from "@/lib/llm/client";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { semanticSearch } from "@/lib/search/semantic";
import {
  assembleContext,
  type ContextInput,
} from "@/lib/writing/context";

const RAG_REFERENCE_LIMIT = 8;
const MIN_COSINE_THRESHOLD = 0.4;
const GENERATION_TEMPERATURE = 0.7;

interface RagConfig {
  mode: "auto" | "manual" | "off";
  documentIds: string[];
}

interface HiddenSectionConstraints {
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
}

function parseHiddenConstraints(value?: string | null): HiddenSectionConstraints {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as Record<string, unknown>;
    return {
      writingRequirements:
        typeof obj.writingRequirements === "string"
          ? obj.writingRequirements
          : undefined,
      retrievalQuery:
        typeof obj.retrievalQuery === "string"
          ? obj.retrievalQuery
          : undefined,
      referenceHints: Array.isArray(obj.referenceHints)
        ? obj.referenceHints.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  } catch {
    return {};
  }
}

function parseKeyPoints(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [value];
  } catch {
    return [value];
  }
}

function buildEffectiveConstraints(
  sectionConstraints?: string | null,
  requestConstraints?: ContextInput["constraints"],
): ContextInput["constraints"] {
  const hidden = parseHiddenConstraints(sectionConstraints);
  const hasHidden =
    Boolean(hidden.writingRequirements) ||
    Boolean(hidden.retrievalQuery) ||
    Boolean(hidden.referenceHints?.length);
  if (!requestConstraints && !hasHidden) {
    return undefined;
  }

  const additionalRequirements = [
    hidden.writingRequirements,
    requestConstraints?.additionalRequirements,
  ].filter(Boolean).join("\n");

  return {
    ...requestConstraints,
    additionalRequirements: additionalRequirements || requestConstraints?.additionalRequirements,
    retrievalQuery: hidden.retrievalQuery,
    referenceHints: hidden.referenceHints,
    writingRequirements: hidden.writingRequirements,
  };
}

async function fetchRagReferences(
  draftTitle: string,
  section: ContextInput["section"] & { constraints?: string | null },
  userId: string,
  ragConfig?: RagConfig
): Promise<ContextInput["ragReferences"]> {
  if (ragConfig?.mode === "off") {
    return [];
  }

  const hidden = parseHiddenConstraints(section.constraints);
  const keyPoints = parseKeyPoints(section.keyPoints);
  const queryParts: string[] = [];

  if (hidden.retrievalQuery?.trim()) {
    queryParts.push(hidden.retrievalQuery.trim(), hidden.retrievalQuery.trim(), hidden.retrievalQuery.trim());
  }
  if (section.title) queryParts.push(section.title);
  if (section.description) queryParts.push(section.description);
  queryParts.push(...keyPoints);
  if (hidden.referenceHints?.length) {
    queryParts.push(...hidden.referenceHints);
  }

  const query = queryParts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");

  try {
    const results = await semanticSearch(query, userId, RAG_REFERENCE_LIMIT);
    let mapped = results
      .filter((result) => result.score >= MIN_COSINE_THRESHOLD)
      .map((result) => ({
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

export interface FullGenerationResult extends GenerationResult {
  modelConfigId: string;
  ragReferences: ContextInput["ragReferences"];
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
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"]
): Promise<GenerationResult> {
  const result = await generateSectionFull(
    draft,
    section,
    completedSections,
    userId,
    constraints,
  );

  return {
    content: result.content,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export async function generateSectionFull(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"],
  customModelConfigId?: string,
): Promise<FullGenerationResult> {
  let provider: ReturnType<typeof createLLMProvider>;
  let modelId: string;
  let modelConfigId: string;

  if (customModelConfigId) {
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
    const resolved = await getLLMClient("writing");
    provider = resolved.provider;
    modelId = resolved.modelId;
    modelConfigId = resolved.modelConfigId;
  }

  const ragReferences = await fetchRagReferences(
    draft.title,
    section,
    userId,
    parseRagConfig(section)
  );

  const effectiveConstraints = buildEffectiveConstraints(
    section.constraints,
    constraints,
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints: effectiveConstraints,
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
      modelConfigId,
      ragReferences,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Section generation failed: ${message}`);
  }
}

export async function generateSectionStream(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
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
    section,
    userId,
    parseRagConfig(section)
  );

  const effectiveConstraints = buildEffectiveConstraints(
    section.constraints,
    constraints,
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints: effectiveConstraints,
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
  ragReferences: ContextInput["ragReferences"];
}

export async function compareSection(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
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
    section,
    userId,
    parseRagConfig(section)
  );

  const effectiveConstraints = buildEffectiveConstraints(
    section.constraints,
    constraints,
  );

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    constraints: effectiveConstraints,
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
      ragReferences,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Section comparison failed: ${message}`);
  }
}
