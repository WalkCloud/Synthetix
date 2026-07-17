import { db } from "@/lib/db";
import { compareTaskIdentitySources } from "@/lib/queue/task-identity-legacy";
import { convertDocumentFile, type ConversionResult } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens, type SplitChunk } from "@/lib/documents/splitter";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import { buildEmbeddingManifest } from "@/lib/documents/embedding-manifest";
import { LocalStorageAdapter, type StorageAdapter } from "@/lib/documents/storage";
import { resolveEmbeddingDim, resolveGraphDowngrade, graphDowngradeWarning } from "@/lib/rag/dimension";
import { buildEmbedConfig, type EmbedConfig } from "@/lib/rag/context";
import { spawnPythonJson } from "@/lib/python";
import { isDaemonEnabled, pythonDaemon } from "@/lib/python-daemon";
import type { ProcessingOptions } from "@/lib/queue/types";
import type { ModelProvider, ModelConfig, Document } from "@/generated/prisma/client";
import { sanitizeMarkdown } from "@/lib/documents/outline/sanitize";
import { splitByMacroAST, coalesceMacroChunks, type MacroChunk } from "@/lib/documents/outline/macro-split";
import { microSplitByLocalSemantic, packChunksBySize } from "@/lib/documents/outline/micro-split";
import { injectBreadcrumbs } from "@/lib/documents/outline/breadcrumb";
import { enforceEmbeddingSafeChunks } from "@/lib/documents/outline/guard";
import { llmRefineMacroStructure } from "@/lib/documents/outline/llm-refine";
import { splitByStructure, loadStructure } from "@/lib/documents/outline/structure-split";
import type { StructureJson } from "@/lib/documents/atoms";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

import { mapBounded } from "@/lib/concurrency/bounded";

type ModelWithProvider = ModelConfig & { provider: ModelProvider };

const EMBED_USAGE_RATIO = 0.9; // 90% of embedding context for chunk text, 10% tokenizer safety margin
const RAG_INDEX_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_index.py");
const EMBEDDING_UPDATE_BATCH_SIZE = Number(process.env.EMBEDDING_UPDATE_BATCH_SIZE || 200);

export interface ProcessingContext {
  taskId: string;
  docId: string;
  doc: Document;
  options: ProcessingOptions;
  outputDir: string;
  markdownPath: string;
  structurePath: string | null;
  imageManifestPath: string | null;
  conversionMethod: "docling" | null;
  writingModel: ModelWithProvider | null;
  embedModel: ModelWithProvider | null;
  contextWindow: number;
  splitThreshold: number;
  chunkMaxTokens: number;
  /** Cancellation signal propagated from the task execution context. */
  signal?: AbortSignal;
}

export interface SplitPlan {
  shouldSplit: boolean;
  tokenCount: number;
  wordCount: number;
}

interface EmbeddingUpdateDb {
  documentChunk: {
    update: (args: {
      where: { id: string };
      data: { embedding: Uint8Array; embedModel: string };
    }) => unknown;
  };
}

export async function persistEmbeddingUpdates(
  updates: Array<{ chunkId: string; embedding: Uint8Array; embedModel: string }>,
  options: { db?: EmbeddingUpdateDb; batchSize?: number } = {},
): Promise<void> {
  const targetDb: EmbeddingUpdateDb = options.db ?? (db as unknown as EmbeddingUpdateDb);
  const batchSize = options.batchSize ?? EMBEDDING_UPDATE_BATCH_SIZE;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    // Single-row updates with P2025 ("Record to update not found") tolerated.
    // The original $transaction(batch.map(update)) would abort the whole
    // batch the instant any chunk row had been deleted out from under us
    // (e.g. document deletion or reprocess racing the embedding worker).
    // Skipping missing rows is the right behaviour here: if a chunk is gone
    // its embedding is moot, and the surviving chunks should still get
    // persisted. Other errors still bubble up.
    //
    // Run the batch with bounded concurrency (5) instead of strictly serial
    // — on a 133-chunk document the serial path paid 133 sequential SQLite
    // round-trips. Each update is independent (own row), so parallelism is
    // safe; P2025 on any row is swallowed without affecting the others.
    const DB_WRITE_CONCURRENCY = 5;
    for (let j = 0; j < batch.length; j += DB_WRITE_CONCURRENCY) {
      const slice = batch.slice(j, j + DB_WRITE_CONCURRENCY);
      await Promise.all(slice.map(async (u) => {
        try {
          await targetDb.documentChunk.update({
            where: { id: u.chunkId },
            data: { embedding: u.embedding, embedModel: u.embedModel },
          });
        } catch (err) {
          const code = (err as { code?: string } | null)?.code;
          if (code === "P2025") return;
          throw err;
        }
      }));
    }
  }
}

export async function loadProcessingTask(taskId: string, signal?: AbortSignal): Promise<ProcessingContext> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  const input = JSON.parse(task.inputData || "{}");
  const docId = compareTaskIdentitySources(task).authoritative.documentId
    ?? (typeof input.docId === "string" ? input.docId : null);
  if (!docId) throw new Error("Missing docId in task input");

  const options: ProcessingOptions = (input.options as ProcessingOptions) || {};

  const doc = await db.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`Document ${docId} not found`);

  // Phase 1 produces these paths and persists them on the document. Phase 2
  // workers (rag-embed-index, document-graph) reload via this function and
  // expect outputDir/markdownPath to be ready, so we resolve them here once
  // rather than relying on each caller to remember.
  const storage = new LocalStorageAdapter();
  const outputDir = storage.getDocumentDir(docId, doc.userId);
  const markdownPath = doc.markdownPath || `${outputDir}/full.md`;

  return {
    taskId,
    docId,
    doc,
    options,
    outputDir,
    markdownPath,
    structurePath: doc.structurePath ?? null,
    imageManifestPath: doc.imageManifestPath ?? null,
    conversionMethod: (doc.conversionMethod as "docling" | null | undefined) ?? null,
    writingModel: null,
    embedModel: null,
    contextWindow: 4096,
    splitThreshold: 2048,
    chunkMaxTokens: 1536,
    signal,
  };
}

export async function convertDocument(
  ctx: ProcessingContext,
  storage: StorageAdapter,
  onProgressEvent?: (event: Record<string, unknown>) => void,
): Promise<string> {
  const outputDir = storage.getDocumentDir(ctx.docId, ctx.doc.userId);

  // Skip the (slow) Docling re-conversion when the source file is unchanged.
  // The cache is keyed on originalHash + originalSize (both already on the
  // Document row from upload) plus a version stamp. forceReconnect opts out,
  // and we only cache when originalHash is present (a null hash was never
  // captured, so it cannot safely identify the source).
  const canCache =
    !ctx.options.forceReconnect && !!ctx.doc.originalHash && ctx.doc.originalSize > 0;
  const cacheKey = canCache
    ? { originalHash: ctx.doc.originalHash as string, originalSize: ctx.doc.originalSize }
    : undefined;

  const result: ConversionResult = await convertDocumentFile(
    ctx.doc.originalPath,
    outputDir,
    cacheKey,
    onProgressEvent,
  );

  ctx.outputDir = outputDir;
  ctx.markdownPath = result.markdown;
  ctx.structurePath = result.structure;
  ctx.imageManifestPath = result.imageManifest;
  ctx.conversionMethod = result.conversionMethod;

  return fsp.readFile(result.markdown, "utf-8");
}

export async function resolveProcessingModels(ctx: ProcessingContext): Promise<void> {
  const options = ctx.options;

  const writingModel = options.llmModelId
    ? (await db.modelConfig.findUnique({ where: { id: options.llmModelId }, include: { provider: true } })) ?? null
    : await resolveModel("writing", ctx.doc.userId);
  const embedModel = options.embedModelId
    ? await db.modelConfig.findUnique({ where: { id: options.embedModelId }, include: { provider: true } })
    : await resolveModel("embedding", ctx.doc.userId);

  // LLM context window: 0 means unset, fall back to 200K (modern default)
  const contextWindow = (writingModel?.contextWindow || 0) > 0 ? writingModel!.contextWindow : 200000;
  const splitRatio = options.contextUsage ? options.contextUsage / 100 : EMBED_USAGE_RATIO;

  // Embedding max input tokens: 0 means unset, fall back to 8192 (standard embedding limit)
  const embedContext = (embedModel?.contextWindow || 0) > 0 ? embedModel!.contextWindow : 8192;
  const chunkMaxTokens = Math.floor(embedContext * splitRatio);
  const splitThreshold = chunkMaxTokens * 2;

  ctx.writingModel = writingModel;
  ctx.embedModel = embedModel;
  ctx.contextWindow = contextWindow;
  ctx.splitThreshold = splitThreshold;
  ctx.chunkMaxTokens = chunkMaxTokens;
}

export function calculateSplitPlan(
  ctx: ProcessingContext,
  markdown: string,
): SplitPlan {
  const tokenCount = estimateTokens(markdown);
  const wordCount = markdown.split(/\s+/).length;
  const shouldSplit = ctx.options.autoSplit !== false && tokenCount > ctx.splitThreshold;

  return { shouldSplit, tokenCount, wordCount };
}

async function splitViaLocalPipeline(
  markdown: string,
  structure: StructureJson | null,
  chunkMaxTokens: number,
  ctx: ProcessingContext,
): Promise<SplitChunk[]> {
  let macros: MacroChunk[];

  // Primary path: structure.json-based chunking (clean headings from Docling).
  if (structure?.sections?.length && structure.sections.length > 1) {
    macros = splitByStructure(markdown, structure, chunkMaxTokens);
    if (macros.length === 0) {
      // structure.json had sections but none matched markdown — fall through.
      macros = null as unknown as MacroChunk[];
    }
  } else {
    macros = null as unknown as MacroChunk[];
  }

  // Fallback: markdown-based chunking (when structure.json is absent or no
  // sections matched the markdown text).
  if (!macros) {
    const clean = sanitizeMarkdown(markdown);
    macros = await splitByMacroAST(clean);
    if (macros.length === 0) return [];

    macros = coalesceMacroChunks(macros, Math.max(400, Math.floor(chunkMaxTokens * 0.4)));
    macros = await llmRefineMacroStructure(macros, ctx);
  }

  const chunks = await microSplitByLocalSemantic(macros, chunkMaxTokens, 0.55);
  // microSplit fragments list/image-heavy sections into one-item chunks;
  // re-pack adjacent same-section fragments back up to retrieval size.
  const packed = packChunksBySize(chunks, chunkMaxTokens);
  const withBreadcrumbs = injectBreadcrumbs(packed);
  const safeChunks = await enforceEmbeddingSafeChunks(withBreadcrumbs, chunkMaxTokens);

  return safeChunks;
}

export async function splitAndPersistChunks(
  ctx: ProcessingContext,
  markdown: string,
  plan: SplitPlan,
  storage: StorageAdapter,
): Promise<void> {
  const { docId, options, chunkMaxTokens } = ctx;

  if (plan.shouldSplit) {
    const splitStrategy = options.splitStrategy || "structure-llm";

    let chunks: SplitChunk[];

    if (splitStrategy === "structure-llm") {
      // Load structure.json for structure-based chunking (preferred over
      // markdown-based heuristic parsing).
      const structure = await loadStructure(ctx.structurePath);
      chunks = await splitViaLocalPipeline(markdown, structure, chunkMaxTokens, ctx);
    } else {
      // heading-only fallback
      chunks = splitMarkdown(markdown, { maxTokens: chunkMaxTokens, overlapTokens: 100 });
    }

    chunks.forEach((c, i) => { c.index = i; });

    await db.documentChunk.deleteMany({ where: { documentId: docId } });

    await db.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        documentId: docId,
        index: chunk.index,
        title: chunk.title,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        headingPath: chunk.headingPath,
      })),
    });

    await mapBounded(
      chunks,
      4,
      (chunk) => storage.saveChunk(docId, chunk.index, chunk.content, ctx.doc.userId),
    );
  } else {
    await db.documentChunk.deleteMany({ where: { documentId: docId } });

    const title = markdown.match(/^#\s+(.+)$/m)?.[1] || ctx.doc.originalName;
    await db.documentChunk.create({
      data: {
        documentId: docId,
        index: 0,
        title,
        content: markdown,
        tokenCount: plan.tokenCount,
        headingPath: title,
      },
    });

    // Persist the single chunk as a file too, mirroring the split branch.
    // File-based consumers (notably rag_index.py graph extraction, which reads
    // chunk_*.md from the doc dir) otherwise see "no chunks found" for any
    // document small enough to skip splitting — silently producing an empty
    // knowledge graph.
    await storage.saveChunk(docId, 0, markdown, ctx.doc.userId);
  }
}

export async function embedDocumentChunks(ctx: ProcessingContext): Promise<void> {
  const { docId, embedModel, doc } = ctx;
  if (!embedModel) return;

  const indexTarget = ctx.options.indexTarget || "full";
  if (indexTarget === "original") return;

  const provider = createLLMProvider(embedModel.provider);

  const allChunks = await db.documentChunk.findMany({
    where: { documentId: docId },
    orderBy: { index: "asc" },
  });

  const texts = allChunks.map((c) => c.content);

  const maxChunkTokens = embedModel.contextWindow || 8192;

  let chunksToEmbed = allChunks;
  let textsToEmbed = texts;

  const oversizeIndices: number[] = [];
  for (let i = 0; i < allChunks.length; i++) {
    if (estimateTokens(texts[i]) > maxChunkTokens) {
      oversizeIndices.push(i);
    }
  }

  if (oversizeIndices.length > 0) {
    const idsToDelete = oversizeIndices.map(i => allChunks[i].id);
    await db.documentChunk.deleteMany({ where: { id: { in: idsToDelete } } });

    let nextIndex = (await db.documentChunk.findFirst({
      where: { documentId: docId },
      orderBy: { index: "desc" },
      select: { index: true },
    }))?.index ?? -1;

    const replacements = oversizeIndices.flatMap(oi => {
      const original = allChunks[oi];
      const subChunks = splitByLinesInternal(texts[oi], maxChunkTokens, original.title ?? "");
      const subs = subChunks.length > 1 ? subChunks : [{
        content: texts[oi].slice(0, Math.floor(maxChunkTokens * 1.5)),
        title: original.title,
        tokenCount: maxChunkTokens,
        headingPath: "",
        index: 0,
      }];
      return subs.map((sc, si) => ({
        documentId: docId,
        index: ++nextIndex,
        title: subs.length > 1 ? `${sc.title} (part ${si + 1}/${subs.length})` : sc.title,
        content: sc.content,
        tokenCount: sc.tokenCount,
        headingPath: original.headingPath || "",
      }));
    });

    await db.documentChunk.createMany({ data: replacements });

    chunksToEmbed = await db.documentChunk.findMany({
      where: { documentId: docId },
      orderBy: { index: "asc" },
    });
    textsToEmbed = chunksToEmbed.map(c => c.content);
  }

  const validChunks = chunksToEmbed;
  const validTexts = textsToEmbed;

  // Smaller batches keep each embed API request light (~4 chunks ≈ 8-16k
  // tokens) so the provider responds fast and is less likely to throttle.
  // The old default of 10 produced ~40k-token batches that could stall for
  // minutes or time out on large documents.
  const baseBatchSize = embedModel.embeddingBatchSize || 4;
  let totalEmbedTokens = 0;
  const writtenEmbeddings = new Map<string, Uint8Array>();
  const totalToEmbed = validTexts.length;
  let embeddedCount = 0;

  // Submit ALL batches at once and let the adaptive limiter (wired into
  // provider.embed) pace them against the provider's real capacity. This
  // replaces the old fixed `CONCURRENT_EMBED_BATCHES = 3` round-robin, which
  // (a) hard-coded a guess at provider capacity and (b) suffered head-of-line
  // blocking — a whole round waited on its slowest batch. With the limiter,
  // each batch's acquire() blocks until budget is free, so batches flow
  // through as fast as the provider allows, with no wasted round-trip idle.
  const batchStarts: number[] = [];
  for (let i = 0; i < validTexts.length; i += baseBatchSize) {
    batchStarts.push(i);
  }

  // Track completion for progress reporting. Each batch reports independently
  // as it finishes (order is arbitrary), so the progress bar advances smoothly
  // instead of stepping per-round.
  const reportProgress = (justEmbedded: number): void => {
    embeddedCount += justEmbedded;
    const embedProgress = 40 + Math.round((embeddedCount / Math.max(totalToEmbed, 1)) * 28);
    void db.asyncTask.updateMany({
      where: { id: ctx.taskId, status: "running" },
      data: { progress: embedProgress },
    }).catch(() => undefined);
  };

  await Promise.all(
    batchStarts.map(async (start) => {
      const end = Math.min(start + baseBatchSize, validTexts.length);
      const embedResult = await provider.embed(
        validTexts.slice(start, end),
        embedModel.modelId,
        embedModel.embeddingDim ?? undefined,
        ctx.signal,
      );
      totalEmbedTokens += embedResult.inputTokens;
      const updates = embedResult.embeddings.map((emb, ei) => {
        const embBuf = float32ToBuffer(new Float32Array(emb));
        const chunkId = validChunks[start + ei].id;
        writtenEmbeddings.set(chunkId, embBuf);
        return { chunkId, embedding: embBuf, embedModel: embedModel.modelId };
      });
      await persistEmbeddingUpdates(updates);
      reportProgress(updates.length);
    }),
  );

  const embeddingsBinPath = path.join(ctx.outputDir, "embeddings.bin");
  const validEmbeddings: Uint8Array[] = [];
  let embedDim = 0;
  for (const chunk of validChunks) {
    const embBuf = writtenEmbeddings.get(chunk.id);
    if (embBuf) {
      if (embedDim === 0) embedDim = embBuf.length / 4;
      validEmbeddings.push(embBuf);
    }
  }
  if (validEmbeddings.length > 0 && embedDim > 0) {
    const header = Buffer.alloc(8);
    header.writeInt32LE(validEmbeddings.length, 0);
    header.writeInt32LE(embedDim, 4);
    await fsp.writeFile(embeddingsBinPath, Buffer.concat([header, ...validEmbeddings]));

    const manifest = buildEmbeddingManifest({
      documentId: docId,
      embedModel: embedModel.modelId,
      embeddingDim: embedDim,
      chunks: validChunks.filter((chunk) => writtenEmbeddings.has(chunk.id)),
    });
    await fsp.writeFile(
      path.join(ctx.outputDir, "embedding_manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
  }

  await recordTokenUsage({
    userId: doc.userId,
    modelConfigId: embedModel.id,
    module: "embedding",
    inputTokens: totalEmbedTokens,
    outputTokens: 0,
    referenceId: docId,
  }).catch((err) => { console.warn("Failed to record embedding token usage:", err); });
}

export async function indexDocument(
  ctx: ProcessingContext,
  onProgressEvent?: (event: Record<string, unknown>) => void,
  taskId?: string,
): Promise<{ rag?: { status: string; chunks: number; error?: string; graphEntities?: number; storage?: Record<string, string> }; indexMode?: string } | null> {
  const { docId, doc, outputDir, embedModel, writingModel, options } = ctx;

  // NOTE: FTS sync is intentionally NOT done here. It was previously called
  // inline, which coupled "keyword index availability" to "LightRAG index".
  // After the pipeline parallelization, graph-mode documents skip this
  // function entirely (graph deletes any basic output anyway) — so an inline
  // FTS call here would silently drop keyword search for every graph-mode
  // document. Callers now own FTS explicitly so it runs unconditionally,
  // regardless of whether the LightRAG basic pass is skipped.
  const indexTarget = options.indexTarget || "full";
  const needRag = indexTarget === "full";
  if (!needRag || !embedModel) return null;

  const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);
  embedModel.embeddingDim = ragEmbedDim;

  let indexMode = (options.indexMode as "basic" | "graph") || "basic";
  const { indexMode: resolvedMode, downgraded } = resolveGraphDowngrade(indexMode, embedModel);
  if (downgraded) {
    console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not compatible with LightRAG graph mode (requires >= 1536), downgrading to basic`);
    // Persist a user-visible warning so the silent downgrade does not look
    // like a successful graph run. The document-graph worker calls this with
    // indexMode "graph" and otherwise marks the task completed + doc ready,
    // so without this trace the knowledge graph would simply appear empty.
    // Prepend so multiple warnings accumulate rather than overwrite.
    const warnMsg = graphDowngradeWarning(embedModel);
    await db.document.update({
      where: { id: docId },
      data: {
        conversionWarning: doc.conversionWarning
          ? `${doc.conversionWarning}\n${warnMsg}`
          : warnMsg,
      },
    }).catch(() => {});
  }
  indexMode = resolvedMode;

  const ragEmbedConfig = embedModel.provider.apiBaseUrl
    ? buildEmbedConfig(embedModel)
    : undefined;

  const ragLlmConfig = writingModel?.provider.apiBaseUrl
    ? buildEmbedConfig(writingModel)
    : undefined;

  let ragRerankConfig: EmbedConfig | undefined;
  try {
    const rerankModel = await resolveModel("rerank", ctx.doc.userId);
    if (rerankModel) {
      ragRerankConfig = buildEmbedConfig(rerankModel);
    }
  } catch {}

  const embeddingsPath = `${outputDir}/embeddings.bin`;

  // ── Graph contextual-prefix chunks (design §9) ────────────────────────────
  // In graph mode, prefer contextual-prefix chunks (small retrieval chunks +
  // their owning Segment's title/summary) over raw retrieval chunks. This
  // keeps entity-extraction fidelity HIGH (small chunks) while restoring the
  // domain context that prevents garbage entities. When contextual chunks are
  // built we MUST NOT reuse retrieval's embeddings.bin — the prefixed text
  // differs from retrieval text, so reusing embeddings would misalign.
  let ragChunksDir = outputDir;
  let graphContextual = false;
  if (indexMode === "graph") {
    try {
      const { buildGraphContextualChunks } = await import("@/lib/documents/graph-chunks");
      const built = await buildGraphContextualChunks(docId, outputDir);
      if (built) {
        ragChunksDir = built.dir;
        graphContextual = built.contextual;
        console.log(`[graph] doc ${docId}: using ${built.count} contextual chunks (prefixes=${built.contextual})`);
      }
    } catch (err) {
      console.warn(`[graph] contextual chunk build failed for doc ${docId}, using retrieval chunks:`, err);
    }
  }

  // Disable embeddings.bin reuse when using contextual graph chunks (text
  // differs). Otherwise reuse the cache when available.
  const hasCachedEmbeddings = !graphContextual && fs.existsSync(embeddingsPath);

  const indexResult = await indexWithLightRAG(
    docId, doc.userId, ragChunksDir, indexMode, ragEmbedDim,
    hasCachedEmbeddings ? undefined : ragEmbedConfig,
    ragLlmConfig,
    hasCachedEmbeddings ? embeddingsPath : undefined,
    ragRerankConfig,
    onProgressEvent,
    (event: Record<string, unknown>) => {
      // Python LightRAG emits one `usage` event per LLM round-trip during graph
      // extraction. Forward each one to recordTokenUsage so the Token Usage
      // Analytics page can attribute graph-mode spend back to the writing model.
      const inputTokens = Number(event.input_tokens ?? 0);
      const outputTokens = Number(event.output_tokens ?? 0);
      if (inputTokens === 0 && outputTokens === 0) return;
      void recordTokenUsage({
        userId: doc.userId,
        modelConfigId: writingModel?.id,
        module: "graph",
        inputTokens,
        outputTokens,
        referenceId: docId,
      }).catch((err) => {
        console.warn("Failed to record graph-mode token usage:", err);
      });
    },
    taskId,
    ctx.signal,
  ).catch((err) => {
    console.warn("LightRAG indexing failed (non-blocking):", err);
    const timeoutOccurred = !!(err as Error & { timeoutOccurred?: boolean })?.timeoutOccurred;
    return { status: "failed", chunks: 0, error: String(err), timeoutOccurred };
  });

  return { rag: indexResult, indexMode };
}

async function indexWithLightRAG(
  docId: string,
  userId: string,
  chunksDir: string,
  indexMode: "basic" | "graph",
  embedDim: number,
  embedConfig?: { apiBase: string; apiKey: string; model: string },
  llmConfig?: { apiBase: string; apiKey: string; model: string },
  embeddingsFile?: string,
  rerankConfig?: { apiBase: string; apiKey: string; model: string },
  onProgressEvent?: (event: Record<string, unknown>) => void,
  onUsageEvent?: (event: Record<string, unknown>) => void,
  taskId?: string,
  signal?: AbortSignal,
): Promise<{
  status: string;
  chunks: number;
  submitted_chunks?: number;
  committed_chunks?: number;
  expected_chunks?: number;
  graphEntities?: number;
  storage?: Record<string, string>;
  error?: string;
  timeoutOccurred?: boolean;
}> {
  // Build the kwargs dict for rag_index.index_document(**params). The daemon
  // takes this verbatim; the spawn fallback rebuilds argv from the same dict so
  // the two paths can never diverge.
  const params: Record<string, unknown> = {
    doc_id: docId,
    user_id: userId,
    chunks_dir: chunksDir,
    index_mode: indexMode,
    embed_dim: embedDim,
  };
  if (taskId) params.task_id = taskId;
  if (embeddingsFile) {
    params.embeddings_file = embeddingsFile;
  } else if (embedConfig) {
    params.embed_api_base = embedConfig.apiBase;
    params.embed_api_key = embedConfig.apiKey;
    params.embed_model = embedConfig.model;
  }
  if (indexMode === "graph" && llmConfig) {
    params.llm_api_base = llmConfig.apiBase;
    params.llm_api_key = llmConfig.apiKey;
    params.llm_model = llmConfig.model;
  }
  if (rerankConfig) {
    params.rerank_api_base = rerankConfig.apiBase;
    params.rerank_api_key = rerankConfig.apiKey;
    params.rerank_model = rerankConfig.model;
  }

  // Basic mode is normally fast (no LLM), but the FIRST index op on a freshly
  // spawned daemon pays interpreter + lightrag import + storage-load (the
  // doc_status store accumulates across documents) which can exceed 120s on a
  // cold daemon. 300s covers that cold path; subsequent ops reuse the resident
  // daemon and finish in seconds. Graph mode is LLM-bound and can run for a
  // long time on large documents; its budget is now configurable so a hard
  // 15-minute ceiling doesn't silently kill big-graph extraction.
  //
  // Env: GRAPH_PYTHON_INDEX_TIMEOUT_MS (default 4h, aligned with the queue's
  // rag_index task timeout). RAG_PYTHON_INDEX_TIMEOUT_MS covers basic mode.
  const defaultGraphTimeout = Number(process.env.GRAPH_PYTHON_INDEX_TIMEOUT_MS) || 14_400_000;
  const defaultBasicTimeout = Number(process.env.RAG_PYTHON_INDEX_TIMEOUT_MS) || 300_000;
  const timeoutMs = indexMode === "graph" ? defaultGraphTimeout : defaultBasicTimeout;

  // argv for the spawn fallback (rebuilt from the same params dict so the two
  // paths can never diverge). Built up front so both daemon-failure fallback
  // and the no-daemon path share it.
  const args = [
    "--doc-id", String(params.doc_id),
    "--user-id", String(params.user_id),
    "--chunks-dir", String(params.chunks_dir),
    "--index-mode", String(params.index_mode),
  ];
  if (Number(params.embed_dim) > 0) args.push("--embed-dim", String(params.embed_dim));
  if (params.embeddings_file) {
    args.push("--embeddings-file", String(params.embeddings_file));
  } else if (params.embed_api_base) {
    args.push(
      "--embed-api-base", String(params.embed_api_base),
      "--embed-api-key", String(params.embed_api_key),
      "--embed-model", String(params.embed_model),
    );
  }
  if (params.index_mode === "graph" && params.llm_api_base) {
    args.push(
      "--llm-api-base", String(params.llm_api_base),
      "--llm-api-key", String(params.llm_api_key),
      "--llm-model", String(params.llm_model),
    );
  }
  if (params.rerank_api_base) {
    args.push(
      "--rerank-api-base", String(params.rerank_api_base),
      "--rerank-api-key", String(params.rerank_api_key),
      "--rerank-model", String(params.rerank_model),
    );
  }

  // Tag errors that are actually timeouts so callers (graph worker) can record
  // `timeoutOccurred` in resultData instead of a misleading "failed" reason.
  // Both code paths reject with messages containing "timeout" / "timed out".
  const tagTimeout = <T>(p: Promise<T>): Promise<T> =>
    p.catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /timed? out|<timeout/i.test(msg);
      if (isTimeout) {
        const wrapped = err instanceof Error ? err : new Error(msg);
        (wrapped as Error & { timeoutOccurred?: boolean }).timeoutOccurred = true;
        throw wrapped;
      }
      throw err;
    });
  const runSpawn = () => tagTimeout(
    spawnPythonJson(RAG_INDEX_SCRIPT, args, {
      timeout: timeoutMs,
      onProgressEvent,
      onUsageEvent,
      signal,
    }) as Promise<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }>,
  );

  if (isDaemonEnabled()) {
    // Do NOT fall back to spawn if the caller cancelled — the daemon process
    // tree was killed on abort, and spawning a fresh writer would race the
    // cancellation. Let the abort error propagate.
    if (signal?.aborted) {
      throw new Error("index was cancelled before dispatch");
    }
    try {
      return await tagTimeout(pythonDaemon.call<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }>(
        "index",
        params,
        { onProgressEvent, onUsageEvent, timeoutMs, signal },
      ));
    } catch (err) {
      // If the caller cancelled, do NOT fall back to spawn.
      if (signal?.aborted) throw err;
      console.warn("[daemon] index op failed, falling back to spawn:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback (daemon disabled or failed): spawn rag_index.py one-shot.
  return await runSpawn();
}

export function splitByLinesInternal(
  content: string,
  maxTokens: number,
  title: string,
): Array<{ index: number; title: string; content: string; tokenCount: number; headingPath: string }> {
  const lines = content.split("\n");
  const chunks: Array<{ index: number; title: string; content: string; tokenCount: number; headingPath: string }> = [];
  let buf = "";
  let bufTokens = 0;
  for (const line of lines) {
    const lt = estimateTokens(line);
    if (bufTokens + lt > maxTokens && buf.length > 0) {
      chunks.push({ index: chunks.length, title, content: buf.trim(), tokenCount: bufTokens, headingPath: "" });
      buf = "";
      bufTokens = 0;
    }
    buf += line + "\n";
    bufTokens += lt;
  }
  if (buf.trim()) {
    chunks.push({ index: chunks.length, title, content: buf.trim(), tokenCount: bufTokens, headingPath: "" });
  }
  if (chunks.length === 0) {
    chunks.push({ index: 0, title, content, tokenCount: estimateTokens(content), headingPath: "" });
  }
  return chunks;
}
