import { getLLMClient } from "@/lib/llm/client";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { semanticSearch } from "@/lib/search/semantic";
import { queryWikiForSection, rewriteWikiQuery } from "@/lib/wiki/query";
import {
  assembleContext,
  type ContextInput,
} from "@/lib/writing/context";
import type { DocumentLanguage } from "@/lib/prompts";
import { buildEffectiveConstraints, parseSectionConstraints } from "@/lib/writing/constraints";

const RAG_REFERENCE_LIMIT = 8;
const MIN_COSINE_THRESHOLD = 0.4;
const GENERATION_TEMPERATURE = 0.7;

const SECTION_ENRICHMENT_PROMPT = `Given the document and section context, generate enrichment metadata as JSON. Output only:
{"retrievalQuery": "optimized search query for knowledge base", "referenceHints": ["keyword1", "keyword2", "framework1"], "writingRequirements": "drafting instructions: what to cover, angle, tone, boundaries, what to avoid"}`;

/** Detect document language from title/content CJK presence */
function detectDocLocale(title: string): DocumentLanguage {
  if (/[一-鿿぀-ヿ가-힯]/.test(title)) return "zh-CN";
  return "en";
}

interface RagConfig {
  mode: "auto" | "manual" | "off";
  documentIds: string[];
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

interface EnrichmentResult {
  retrievalQuery?: string;
  referenceHints?: string[];
  writingRequirements?: string;
}

async function enrichSectionContext(
  section: ContextInput["section"] & { constraints?: string | null },
  draftTitle: string,
  provider: ReturnType<typeof createLLMProvider>,
  modelId: string,
): Promise<EnrichmentResult> {
  const hidden = parseSectionConstraints(section.constraints);
  if (hidden.retrievalQuery || hidden.referenceHints) {
    return hidden;
  }

  try {
    const keyPoints = parseKeyPoints(section.keyPoints);
    const context = [
      `Document: ${draftTitle}`,
      section.title && `Section: ${section.title}`,
      section.description && `Scope: ${section.description}`,
      keyPoints.length && `Key points: ${keyPoints.join(", ")}`,
    ].filter(Boolean).join("\n");

    const response = await provider.chat({
      model: modelId,
      messages: [
        { role: "system", content: SECTION_ENRICHMENT_PROMPT },
        { role: "user", content: context },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.content.trim()) as Record<string, unknown>;
    return {
      retrievalQuery: typeof parsed.retrievalQuery === "string" ? parsed.retrievalQuery : undefined,
      referenceHints: Array.isArray(parsed.referenceHints) ? parsed.referenceHints.filter((h): h is string => typeof h === "string") : undefined,
      writingRequirements: typeof parsed.writingRequirements === "string" ? parsed.writingRequirements : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Query the Wiki synthesized layer for a section (the "cheap retrieval" half
 * of the LLM-Wiki flywheel). Returns entries that get injected into the
 * context as higher-level knowledge, BEFORE raw RAG retrieval.
 *
 * Pure SQL — no LLM, no embeddings — so this is essentially free vs the
 * semanticSearch call. When Wiki has good coverage, the RAG limit is
 * halved (we already have synthesized knowledge, so fewer raw chunks needed).
 */
async function fetchWikiContext(
  draftTitle: string,
  section: ContextInput["section"] & { constraints?: string | null },
  userId: string,
  provider: ReturnType<typeof createLLMProvider>,
  modelId: string,
): Promise<{ entries: NonNullable<ContextInput["wikiEntries"]>; usedEntryIds: string[] }> {
  try {
    const hidden = parseSectionConstraints(section.constraints);
    // MemoRAG-style memory-guided retrieval: rewrite the section brief into
    // Wiki-title-aligned search terms so semantically-related entries that
    // don't keyword-match the raw query can be recalled. Non-blocking: an
    // empty array on failure falls back to tokenized-only matching.
    const rewrittenTerms = await rewriteWikiQuery(
      section,
      draftTitle,
      provider,
      modelId,
      hidden.retrievalQuery,
    );
    const entries = await queryWikiForSection(
      section,
      draftTitle,
      userId,
      hidden.retrievalQuery,
      undefined,
      rewrittenTerms,
    );
    return {
      entries: entries.map((e) => ({
        id: e.id,
        title: e.title,
        content: e.content,
        confidence: e.confidence,
        type: e.type,
      })),
      usedEntryIds: entries.map((e) => e.id),
    };
  } catch (err) {
    // Wiki is a pure enhancement — never block generation on it.
    console.warn("Wiki query failed (non-blocking):", err);
    return { entries: [], usedEntryIds: [] };
  }
}

async function fetchRagReferences(
  draftTitle: string,
  section: ContextInput["section"] & { constraints?: string | null },
  userId: string,
  ragConfig?: RagConfig,
  limit: number = RAG_REFERENCE_LIMIT,
): Promise<ContextInput["ragReferences"]> {
  if (ragConfig?.mode === "off") {
    return [];
  }

  const hidden = parseSectionConstraints(section.constraints);
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
    const results = await semanticSearch(query, userId, limit);
    let mapped = results
      .filter((result) => result.score >= MIN_COSINE_THRESHOLD)
      .map((result) => ({
        documentId: result.documentId,
        chunkId: result.chunkId,
        documentName: result.documentName,
        title: result.title,
        content: result.content,
        score: result.score,
        sourceType: (result.source === "lightrag" ? "rag_graph" : "rag_chunk") as "rag_graph" | "rag_chunk",
      }));

    if (ragConfig?.mode === "manual" && ragConfig.documentIds.length > 0) {
      const allowed = new Set(ragConfig.documentIds);
      mapped = mapped.filter((r) => r.documentId && allowed.has(r.documentId));
    }

    return mapped;
  } catch (error: unknown) {
    // RAG is an enhancement, not a hard dependency. A daemon timeout, a slow
    // direct-embedding scan, or a transient embedding-model failure used to
    // abort the whole section (surfacing as status:"failed" in the SSE route).
    // Degrade to empty — the Wiki flywheel and the LLM's own knowledge still
    // produce a usable draft. This mirrors the fail-soft contract already used
    // by fetchWikiContext and enrichSectionContext.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(
      `[rag] retrieval failed (non-blocking, degrading to wiki/empty): ${message}`,
    );
    return [];
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
  /** Wiki entries injected into the context (ids used by the writeback flywheel). */
  wikiEntries: NonNullable<ContextInput["wikiEntries"]>;
}

function parseRagConfig(section: { ragMode?: string; ragDocumentIds?: string | null }): RagConfig {
  const mode = (section.ragMode || "auto") as RagConfig["mode"];
  let documentIds: string[] = [];
  try {
    documentIds = JSON.parse(section.ragDocumentIds || "[]");
  } catch { documentIds = []; }
  return { mode, documentIds };
}

// ─── Internal deep module: shared generation context preparation ────────────
// Extracted from generateSectionFull/generateSectionStream to eliminate 80%
// duplicate code (design §4.3). Both functions now delegate to this helper,
// ensuring enrichment, wiki retrieval, RAG, and context assembly stay in sync.

interface PreparedGenerationContext {
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
  messages: ReturnType<typeof assembleContext>;
  ragReferences: ContextInput["ragReferences"];
  wikiEntries: NonNullable<ContextInput["wikiEntries"]>;
  wikiEntryIds: string[];
}

/** Resolve the LLM provider/model, preferring an explicit custom config. */
export async function resolveGenerationProvider(
  userId: string,
  customModelConfigId?: string,
): Promise<{
  provider: ReturnType<typeof createLLMProvider>;
  modelId: string;
  modelConfigId: string;
}> {
  if (customModelConfigId) {
    const { db } = await import("@/lib/db");
    const modelConfig = await db.modelConfig.findUnique({
      where: { id: customModelConfigId },
      include: { provider: true },
    });
    if (!modelConfig?.provider || modelConfig.provider.userId !== userId) {
      throw new Error(`Model config ${customModelConfigId} not found`);
    }
    return {
      provider: createLLMProvider({
        apiBaseUrl: modelConfig.provider.apiBaseUrl,
        apiKey: modelConfig.provider.apiKey,
        providerType: modelConfig.provider.providerType,
      }),
      modelId: modelConfig.modelId,
      modelConfigId: modelConfig.id,
    };
  }
  const resolved = await getLLMClient("writing", userId);
  return {
    provider: resolved.provider,
    modelId: resolved.modelId,
    modelConfigId: resolved.modelConfigId,
  };
}

/**
 * Prepare the full generation context: resolve provider → concurrently
 * enrich + fetch wiki → fetch RAG → build constraints → assemble messages.
 *
 * Shared by generateSectionFull and generateSectionStream so enrichment,
 * wiki, RAG, and context assembly can never drift out of sync.
 */
async function prepareGenerationContext(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  constraints?: ContextInput["constraints"],
  customModelConfigId?: string,
): Promise<PreparedGenerationContext> {
  const { provider, modelId, modelConfigId } = await resolveGenerationProvider(userId, customModelConfigId);

  // Enrichment and Wiki retrieval are independent: enrichment tunes the LLM
  // prompt (effectiveConstraints) while Wiki is a pure SQL+rewrite recall that
  // does not consume enrichment output. Run them concurrently to cut one serial
  // LLM round-trip off the pre-stream critical path. RAG still runs after Wiki
  // because its limit depends on the Wiki entry count.
  const [enrichment, wiki] = await Promise.all([
    enrichSectionContext(section, draft.title, provider, modelId),
    fetchWikiContext(draft.title, section, userId, provider, modelId),
  ]);

  const wikiRefs: ContextInput["ragReferences"] = wiki.entries.map((e) => ({
    documentName: "Knowledge Base",
    title: e.title,
    content: e.content,
    score: e.confidence,
    sourceType: "wiki" as const,
  }));

  const ragReferences = await fetchRagReferences(
    draft.title,
    section,
    userId,
    parseRagConfig(section),
    wiki.entries.length >= 3 ? Math.ceil(RAG_REFERENCE_LIMIT / 2) : RAG_REFERENCE_LIMIT,
  );

  // Combine: Wiki references first (higher-level), then raw RAG
  const allReferences = [...wikiRefs, ...ragReferences];

  const baseConstraints = buildEffectiveConstraints(
    section.constraints,
    constraints,
  );

  const effectiveConstraints = baseConstraints || enrichment.retrievalQuery || enrichment.writingRequirements
    ? {
        ...baseConstraints,
        retrievalQuery: baseConstraints?.retrievalQuery || enrichment.retrievalQuery,
        referenceHints: baseConstraints?.referenceHints || enrichment.referenceHints,
        writingRequirements: baseConstraints?.writingRequirements || enrichment.writingRequirements,
        additionalRequirements: baseConstraints?.additionalRequirements,
      }
    : undefined;

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences: allReferences,
    wikiEntries: wiki.entries,
    constraints: effectiveConstraints,
  }, detectDocLocale(draft.title));

  return {
    provider,
    modelId,
    modelConfigId,
    messages,
    ragReferences: allReferences,
    wikiEntries: wiki.entries,
    wikiEntryIds: wiki.usedEntryIds,
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
  const ctx = await prepareGenerationContext(
    draft, section, completedSections, userId, constraints, customModelConfigId,
  );

  try {
    const response = await ctx.provider.chat({
      model: ctx.modelId,
      messages: ctx.messages,
      temperature: GENERATION_TEMPERATURE,
    });

    if (!response.content.trim()) {
      throw new Error(
        "Model returned empty content for section generation."
      );
    }

    await recordTokenUsageSafely({
      userId,
      modelConfigId: ctx.modelConfigId,
      module: "writing",
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });

    return {
      content: response.content,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      modelConfigId: ctx.modelConfigId,
      ragReferences: ctx.ragReferences,
      wikiEntries: ctx.wikiEntries,
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
  const ctx = await prepareGenerationContext(
    draft, section, completedSections, userId, constraints, customModelConfigId,
  );

  const stream = ctx.provider.chatStream({
    model: ctx.modelId,
    messages: ctx.messages,
    temperature: GENERATION_TEMPERATURE,
    stream: true,
  });

  return { stream, modelConfigId: ctx.modelConfigId, ragReferences: ctx.ragReferences, wikiEntries: ctx.wikiEntries, wikiEntryIds: ctx.wikiEntryIds };
}

export interface CompareStreamCallbacks {
  onReferences?: (refs: ContextInput["ragReferences"]) => void;
  onChunk: (source: "a" | "b", content: string) => void;
  onDone: (result: {
    contentA: string;
    contentB: string;
    modelA: string;
    modelB: string;
    inputTokensA: number;
    outputTokensA: number;
    inputTokensB: number;
    outputTokensB: number;
    contentASource?: "a";
    contentBSource?: "b";
  }) => void;
  onError: (source: "a" | "b", error: string) => void;
}

export async function compareSectionStream(
  draft: ContextInput["draft"],
  section: ContextInput["section"] & { constraints?: string | null; ragMode?: string; ragDocumentIds?: string | null },
  completedSections: ContextInput["completedSections"],
  userId: string,
  modelAConfig: { provider: unknown; modelId: string; modelConfigId?: string },
  modelBConfig: { provider: unknown; modelId: string; modelConfigId?: string },
  constraints: ContextInput["constraints"] | undefined,
  callbacks: CompareStreamCallbacks,
): Promise<void> {
  const providerA = modelAConfig.provider as ReturnType<typeof createLLMProvider>;
  const providerB = modelBConfig.provider as ReturnType<typeof createLLMProvider>;

  const enrichment = await enrichSectionContext(section, draft.title, providerA, modelAConfig.modelId);

  // Phase 3 fix: compare mode MUST also retrieve Wiki context — previously it
  // only ran RAG, missing the synthesized knowledge layer that single mode gets.
  const wikiResult = await fetchWikiContext(
    draft.title,
    section,
    userId,
    providerA,
    modelAConfig.modelId,
  ).catch(() => ({ entries: [] as NonNullable<ContextInput["wikiEntries"]>, usedEntryIds: [] as string[] }));
  const wikiEntries = wikiResult.entries;
  const wikiEntryIds = wikiResult.usedEntryIds;

  const ragLimit = wikiEntries.length >= 3
    ? Math.ceil(RAG_REFERENCE_LIMIT / 2)
    : RAG_REFERENCE_LIMIT;
  const ragReferences = await fetchRagReferences(
    draft.title,
    section,
    userId,
    parseRagConfig(section),
    ragLimit,
  );

  callbacks.onReferences?.(ragReferences);

  const baseConstraints = buildEffectiveConstraints(
    section.constraints,
    constraints,
  );

  const effectiveConstraints = baseConstraints || enrichment.retrievalQuery || enrichment.writingRequirements
    ? {
        ...baseConstraints,
        retrievalQuery: baseConstraints?.retrievalQuery || enrichment.retrievalQuery,
        referenceHints: baseConstraints?.referenceHints || enrichment.referenceHints,
        writingRequirements: baseConstraints?.writingRequirements || enrichment.writingRequirements,
        additionalRequirements: baseConstraints?.additionalRequirements,
      }
    : undefined;

  const messages = assembleContext({
    draft,
    section,
    completedSections,
    ragReferences,
    wikiEntries: wikiEntries.length > 0 ? wikiEntries : undefined,
    constraints: effectiveConstraints,
  }, detectDocLocale(draft.title));

  const chatParams = {
    messages,
    temperature: GENERATION_TEMPERATURE,
    stream: true as const,
  };

  let contentA = "";
  let contentB = "";
  let modelA = "";
  let modelB = "";
  let inputTokensA = 0;
  let outputTokensA = 0;
  let inputTokensB = 0;
  let outputTokensB = 0;

  await Promise.allSettled([
    (async () => {
      try {
        const stream = providerA.chatStream({ ...chatParams, model: modelAConfig.modelId });
        for await (const chunk of stream) {
          if (chunk.content) {
            contentA += chunk.content;
            callbacks.onChunk("a", chunk.content);
          }
          if (chunk.done) {
            modelA = modelAConfig.modelId;
            inputTokensA = chunk.inputTokens ?? 0;
            outputTokensA = chunk.outputTokens ?? 0;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        callbacks.onError("a", message);
      }
    })(),
    (async () => {
      try {
        const stream = providerB.chatStream({ ...chatParams, model: modelBConfig.modelId });
        for await (const chunk of stream) {
          if (chunk.content) {
            contentB += chunk.content;
            callbacks.onChunk("b", chunk.content);
          }
          if (chunk.done) {
            modelB = modelBConfig.modelId;
            inputTokensB = chunk.inputTokens ?? 0;
            outputTokensB = chunk.outputTokens ?? 0;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        callbacks.onError("b", message);
      }
    })(),
  ]);

  callbacks.onDone({
    contentA,
    contentB,
    modelA,
    modelB,
    inputTokensA,
    outputTokensA,
    inputTokensB,
    outputTokensB,
  });
}
