import { db } from "@/lib/db";
import { convertToMarkdown } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens } from "@/lib/documents/splitter";
import { semanticSplit } from "@/lib/documents/semantic-splitter";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import type { StorageAdapter } from "@/lib/documents/storage";
import { resolveEmbeddingDim, isLightRAGCompatible } from "@/lib/rag/dimension";
import { buildEmbedConfig, type EmbedConfig } from "@/lib/rag/context";
import { syncFtsIndexForDocument } from "@/lib/search/fts";
import { spawnPythonJson } from "@/lib/python";
import type { ProcessingOptions } from "@/lib/queue/types";
import type { ModelProvider, ModelConfig, Document } from "@/generated/prisma/client";
import fs from "fs";
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

const DEFAULT_SPLIT_RATIO = parseFloat(process.env.SPLIT_THRESHOLD || "0.5");
const DEFAULT_CHUNK_TARGET_TOKENS = parseInt(process.env.CHUNK_TARGET_TOKENS || "800", 10);
const RAG_INDEX_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_index.py");

export interface ProcessingContext {
  taskId: string;
  docId: string;
  doc: Document;
  options: ProcessingOptions;
  outputDir: string;
  markdownPath: string;
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

export async function loadProcessingTask(taskId: string): Promise<ProcessingContext> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  const input = JSON.parse(task.inputData || "{}");
  const docId = input.docId;
  if (!docId) throw new Error("Missing docId in task input");

  const options: ProcessingOptions = (input.options as ProcessingOptions) || {};

  const doc = await db.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`Document ${docId} not found`);

  return {
    taskId,
    docId,
    doc,
    options,
    outputDir: "",
    markdownPath: "",
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
  await convertToMarkdown(ctx.doc.originalPath, outputDir);
  const markdownPath = `${outputDir}/full.md`;

  ctx.outputDir = outputDir;
  ctx.markdownPath = markdownPath;

  return fs.readFileSync(markdownPath, "utf-8");
}

export async function resolveProcessingModels(ctx: ProcessingContext): Promise<void> {
  const options = ctx.options;

  const writingModel = options.llmModelId
    ? (await db.modelConfig.findUnique({ where: { id: options.llmModelId }, include: { provider: true } })) ?? null
    : await resolveModel("writing", ctx.doc.userId);
  const embedModel = options.embedModelId
    ? await db.modelConfig.findUnique({ where: { id: options.embedModelId }, include: { provider: true } })
    : await resolveModel("embedding", ctx.doc.userId);

  const contextWindow = writingModel?.contextWindow || 4096;
  const splitRatio = options.contextUsage ? options.contextUsage / 100 : DEFAULT_SPLIT_RATIO;
  const splitThreshold = Math.floor(contextWindow * splitRatio);

  const embedContext = embedModel?.contextWindow || 8192;
  const chunkMaxTokens = Math.min(DEFAULT_CHUNK_TARGET_TOKENS, Math.floor(embedContext * 0.75));

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

export async function splitAndPersistChunks(
  ctx: ProcessingContext,
  markdown: string,
  plan: SplitPlan,
  storage: StorageAdapter,
): Promise<void> {
  const { docId, options, chunkMaxTokens, writingModel } = ctx;

  if (plan.shouldSplit) {
    let chunks = splitMarkdown(markdown, { maxTokens: chunkMaxTokens, overlapTokens: 100 });

    const splitStrategy = options.splitStrategy || "structure-llm";
    if (splitStrategy !== "heading-only" && writingModel && chunks.length > 1) {
      try {
        const splitTimeout = Math.min(60_000 + chunks.length * 5_000, 300_000);
        const result = await Promise.race([
          semanticSplit(chunks, writingModel),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Semantic split timed out after ${splitTimeout / 1000}s`)), splitTimeout);
          }),
        ]);
        chunks = result.chunks;

        if (result.inputTokens > 0 || result.outputTokens > 0) {
          await recordTokenUsage({
            userId: ctx.doc.userId,
            modelConfigId: writingModel.id,
            module: "chunking",
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            referenceId: ctx.docId,
          }).catch(() => {});
        }

        const subChunks: typeof chunks = [];
        for (const chunk of chunks) {
          if (chunk.tokenCount <= chunkMaxTokens) {
            subChunks.push(chunk);
          } else {
            const parts = splitByLinesInternal(chunk.content, chunkMaxTokens, chunk.title);
            for (const part of parts) {
              subChunks.push({
                ...part,
                headingPath: chunk.headingPath,
              });
            }
          }
        }
        chunks = subChunks;
        chunks.forEach((c, i) => { c.index = i; });
      } catch (err) {
        console.warn("Semantic split failed, using structural chunks:", err);
      }
    }

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
      8,
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
  });

  const texts = allChunks.map((c) => c.content);

  const validChunks: typeof allChunks = [];
  const validTexts: string[] = [];
  const maxChunkTokens = embedModel.contextWindow || 8192;
  for (let i = 0; i < allChunks.length; i++) {
    if (estimateTokens(texts[i]) <= maxChunkTokens) {
      validChunks.push(allChunks[i]);
      validTexts.push(texts[i]);
    } else {
      console.warn(`Skipping embedding for chunk ${allChunks[i].id}: ${estimateTokens(texts[i])} tokens exceeds model limit ${maxChunkTokens}`);
    }
  }

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
      requests.push(provider.embed(validTexts.slice(start, end), embedModel.modelId));
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
        return { chunkId, embedding: embBuf };
      });
      await boundedAll(updates, (u) =>
        db.documentChunk.update({
          where: { id: u.chunkId },
          data: { embedding: u.embedding, embedModel: embedModel.modelId },
        }),
        5,
      );
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
    fs.writeFileSync(embeddingsBinPath, Buffer.concat([header, ...validEmbeddings]));
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

export async function indexDocument(ctx: ProcessingContext): Promise<{ rag?: { status: string; chunks: number; error?: string; graphEntities?: number; storage?: Record<string, string> }; indexMode?: string } | null> {
  const { docId, doc, outputDir, embedModel, writingModel, options } = ctx;

  await syncFtsIndexForDocument(docId).catch((err) => { console.warn("FTS index sync failed:", err); });

  const indexTarget = options.indexTarget || "full";
  const needRag = indexTarget === "full";
  if (!needRag || !embedModel) return null;

  let indexMode = options.indexMode || "basic";
  if (indexMode === "graph" && !isLightRAGCompatible(embedModel)) {
    console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not compatible with LightRAG graph mode (requires >= 1536), downgrading to basic`);
    indexMode = "basic";
  }

  const ragChunksDir = outputDir;
  const ragEmbedConfig = embedModel.provider.apiKey
    ? buildEmbedConfig(embedModel)
    : undefined;

  const ragLlmConfig = writingModel?.provider.apiKey
    ? buildEmbedConfig(writingModel)
    : undefined;

  const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);

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
  ).catch((err) => {
    console.warn("LightRAG indexing failed (non-blocking):", err);
    return { status: "failed", chunks: 0, error: String(err) };
  });

  return { rag: indexResult, indexMode };
}

export function indexWithLightRAG(
  docId: string,
  userId: string,
  chunksDir: string,
  indexMode: "basic" | "graph",
  embedDim: number,
  embedConfig?: { apiBase: string; apiKey: string; model: string },
  llmConfig?: { apiBase: string; apiKey: string; model: string },
  embeddingsFile?: string,
  rerankConfig?: { apiBase: string; apiKey: string; model: string },
): Promise<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }> {
  const args = [
    "--doc-id", docId,
    "--user-id", userId,
    "--chunks-dir", chunksDir,
    "--index-mode", indexMode,
  ];
  if (embedDim > 0) args.push("--embed-dim", String(embedDim));
  if (embeddingsFile) {
    args.push("--embeddings-file", embeddingsFile);
  } else if (embedConfig) {
    args.push(
      "--embed-api-base", embedConfig.apiBase,
      "--embed-api-key", embedConfig.apiKey,
      "--embed-model", embedConfig.model,
    );
  }
  if (indexMode === "graph" && llmConfig) {
    args.push(
      "--llm-api-base", llmConfig.apiBase,
      "--llm-api-key", llmConfig.apiKey,
      "--llm-model", llmConfig.model,
    );
  }
  if (rerankConfig) {
    args.push(
      "--rerank-api-base", rerankConfig.apiBase,
      "--rerank-api-key", rerankConfig.apiKey,
      "--rerank-model", rerankConfig.model,
    );
  }
  return spawnPythonJson(RAG_INDEX_SCRIPT, args, {
    timeout: indexMode === "graph" ? 600_000 : 120_000,
  });
}

export async function indexDocumentImages(
  ctx: ProcessingContext,
): Promise<void> {
  const imagesDir = path.join(ctx.outputDir, "images");
  if (!fs.existsSync(imagesDir)) return;

  const files = fs.readdirSync(imagesDir).filter((f) => !f.startsWith("."));
  if (files.length === 0) return;

  const markdownPath = path.join(ctx.outputDir, "full.md");
  const markdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf-8") : "";

  const altMap = new Map<string, string>();
  const altRegex = /!\[([^\]]*)\]\(images\/([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = altRegex.exec(markdown)) !== null) {
    altMap.set(match[2], match[1]);
  }

  for (const filename of files) {
    const filePath = path.join(imagesDir, filename);
    const stat = fs.statSync(filePath);

    await db.documentImage.upsert({
      where: {
        documentId_filename: { documentId: ctx.docId, filename },
      },
      create: {
        documentId: ctx.docId,
        filename,
        altText: altMap.get(filename) || null,
        mimeType: `image/${path.extname(filename).replace(".", "")}`,
        fileSize: stat.size,
        width: null,
        height: null,
        pageNumber: null,
        hash: null,
      },
      update: {
        altText: altMap.get(filename) || null,
        mimeType: `image/${path.extname(filename).replace(".", "")}`,
        fileSize: stat.size,
      },
    });
  }
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
