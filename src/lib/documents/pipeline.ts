import { db } from "@/lib/db";
import { convertDocumentFile, type ConversionResult } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens, type SplitChunk } from "@/lib/documents/splitter";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import { buildEmbeddingManifest } from "@/lib/documents/embedding-manifest";
import { LocalStorageAdapter, type StorageAdapter } from "@/lib/documents/storage";
import { resolveEmbeddingDim, isLightRAGCompatible } from "@/lib/rag/dimension";
import { buildEmbedConfig, type EmbedConfig } from "@/lib/rag/context";
import { syncFtsIndexForDocument } from "@/lib/search/fts";
import { spawnPythonJson } from "@/lib/python";
import { isDaemonEnabled, pythonDaemon } from "@/lib/python-daemon";
import type { ProcessingOptions } from "@/lib/queue/types";
import type { ModelProvider, ModelConfig, Document } from "@/generated/prisma/client";
import { sanitizeMarkdown } from "@/lib/documents/outline/sanitize";
import { splitByMacroAST, coalesceMacroChunks } from "@/lib/documents/outline/macro-split";
import { microSplitByLocalSemantic, packChunksBySize } from "@/lib/documents/outline/micro-split";
import { injectBreadcrumbs } from "@/lib/documents/outline/breadcrumb";
import { enforceEmbeddingSafeChunks } from "@/lib/documents/outline/guard";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";

async function boundedAll<T>(items: T[], fn: (item: T) => Promise<unknown>, concurrency: number): Promise<void> {
  let idx = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push((async () => {
      while (idx < items.length) {
        const i = idx++;
        if (i >= items.length) break;
        await fn(items[i]);
      }
    })());
  }
  await Promise.all(workers);
}

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
    for (const u of batch) {
      try {
        await targetDb.documentChunk.update({
          where: { id: u.chunkId },
          data: { embedding: u.embedding, embedModel: u.embedModel },
        });
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "P2025") continue;
        throw err;
      }
    }
  }
}

export async function loadProcessingTask(taskId: string): Promise<ProcessingContext> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  const input = JSON.parse(task.inputData || "{}");
  const docId = input.docId;
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
  };
}

export async function convertDocument(
  ctx: ProcessingContext,
  storage: StorageAdapter,
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
  chunkMaxTokens: number,
): Promise<SplitChunk[]> {
  const clean = sanitizeMarkdown(markdown);
  let macros = await splitByMacroAST(clean);
  if (macros.length === 0) return [];

  // Merge small adjacent chunks before micro-splitting
  macros = coalesceMacroChunks(macros, Math.max(400, Math.floor(chunkMaxTokens * 0.4)));

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
      chunks = await splitViaLocalPipeline(markdown, chunkMaxTokens);
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

    await boundedAll(
      chunks,
      (chunk) => storage.saveChunk(docId, chunk.index, chunk.content, ctx.doc.userId),
      4,
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

  const baseBatchSize = embedModel.embeddingBatchSize || 10;
  const CONCURRENT_EMBED_BATCHES = 3;
  let totalEmbedTokens = 0;
  const writtenEmbeddings = new Map<string, Uint8Array>();

  for (let i = 0; i < validTexts.length; i += baseBatchSize * CONCURRENT_EMBED_BATCHES) {
    const requests: Promise<{ embeddings: number[][]; inputTokens: number }>[] = [];
    const offsets: number[] = [];

    for (let j = 0; j < CONCURRENT_EMBED_BATCHES; j++) {
      const start = i + j * baseBatchSize;
      if (start >= validTexts.length) break;
      const end = Math.min(start + baseBatchSize, validTexts.length);
      offsets.push(start);
      requests.push(provider.embed(validTexts.slice(start, end), embedModel.modelId, embedModel.embeddingDim ?? undefined));
    }

    const results = await Promise.all(requests);

    for (let ri = 0; ri < results.length; ri++) {
      const embedResult = results[ri];
      totalEmbedTokens += embedResult.inputTokens;
      const start = offsets[ri];

      const updates = embedResult.embeddings.map((emb, ei) => {
        const embBuf = float32ToBuffer(new Float32Array(emb));
        const chunkId = validChunks[start + ei].id;
        writtenEmbeddings.set(chunkId, embBuf);
        return { chunkId, embedding: embBuf, embedModel: embedModel.modelId };
      });
      await persistEmbeddingUpdates(updates);
    }
  }

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
): Promise<{ rag?: { status: string; chunks: number; error?: string; graphEntities?: number; storage?: Record<string, string> }; indexMode?: string } | null> {
  const { docId, doc, outputDir, embedModel, writingModel, options } = ctx;

  await syncFtsIndexForDocument(docId).catch((err) => { console.warn("FTS index sync failed:", err); });

  const indexTarget = options.indexTarget || "full";
  const needRag = indexTarget === "full";
  if (!needRag || !embedModel) return null;

  const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);
  embedModel.embeddingDim = ragEmbedDim;

  let indexMode = options.indexMode || "basic";
  if (indexMode === "graph" && !isLightRAGCompatible(embedModel)) {
    console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not compatible with LightRAG graph mode (requires >= 1536), downgrading to basic`);
    indexMode = "basic";
  }

  const ragChunksDir = outputDir;
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
  const hasCachedEmbeddings = fs.existsSync(embeddingsPath);

  const indexResult = await indexWithLightRAG(
    docId, doc.userId, ragChunksDir, indexMode, ragEmbedDim,
    hasCachedEmbeddings ? undefined : ragEmbedConfig,
    ragLlmConfig,
    hasCachedEmbeddings ? embeddingsPath : undefined,
    ragRerankConfig,
    onProgressEvent,
    (event) => {
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
  ).catch((err) => {
    console.warn("LightRAG indexing failed (non-blocking):", err);
    return { status: "failed", chunks: 0, error: String(err) };
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
): Promise<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }> {
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
  // daemon and finish in seconds. Graph mode keeps its long LLM-bound budget.
  const timeoutMs = indexMode === "graph" ? 900_000 : 300_000;

  if (isDaemonEnabled()) {
    try {
      return await pythonDaemon.call<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }>(
        "index",
        params,
        { onProgressEvent, onUsageEvent, timeoutMs },
      );
    } catch (err) {
      console.warn("[daemon] index op failed, falling back to spawn:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback (daemon disabled or failed): rebuild argv from the same params and
  // spawn rag_index.py one-shot — identical to the pre-daemon behavior.
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
  return spawnPythonJson(RAG_INDEX_SCRIPT, args, {
    timeout: timeoutMs,
    onProgressEvent,
    onUsageEvent,
  });
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
