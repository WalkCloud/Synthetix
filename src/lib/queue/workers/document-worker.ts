import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { convertToMarkdown } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens } from "@/lib/documents/splitter";
import { semanticSplit } from "@/lib/documents/semantic-splitter";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { normalizeProviderBaseUrl } from "@/lib/llm/provider-endpoints";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { resolveEmbeddingDim, isLightRAGCompatible } from "@/lib/rag/dimension";
import { syncFtsIndexForDocument } from "@/lib/search/fts";
import { spawnPythonJson } from "@/lib/python";
import type { ProcessingOptions } from "@/lib/queue/types";
import fs from "fs";
import path from "path";

const storage = new LocalStorageAdapter();
const DEFAULT_SPLIT_RATIO = parseFloat(process.env.SPLIT_THRESHOLD || "0.5");
const RAG_INDEX_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_index.py");

function indexWithLightRAG(
  docId: string,
  userId: string,
  chunksDir: string,
  indexMode: "basic" | "graph",
  embedDim: number,
  embedConfig?: { apiBase: string; apiKey: string; model: string },
  llmConfig?: { apiBase: string; apiKey: string; model: string },
  embeddingsFile?: string,
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
  return spawnPythonJson(RAG_INDEX_SCRIPT, args, {
    timeout: indexMode === "graph" ? 600_000 : 120_000,
  });
}

export async function processDocument(taskId: string): Promise<void> {
  const task = await db.asyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task ${taskId} not found`);

  const input = JSON.parse(task.inputData || "{}");
  const docId = input.docId;
  if (!docId) throw new Error("Missing docId in task input");

  const options: ProcessingOptions = (input.options as ProcessingOptions) || {};

  await db.asyncTask.update({
    where: { id: taskId },
    data: { status: "running", progress: 10 },
  });
  await db.document.update({
    where: { id: docId },
    data: { status: "converting" },
  });

  const doc = await db.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`Document ${docId} not found`);

  try {
    const userId = doc.userId;
    const outputDir = storage.getDocumentDir(docId, userId);
    await convertToMarkdown(doc.originalPath, outputDir);
    const markdownPath = `${outputDir}/full.md`;

    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 40 },
    });

    const markdown = fs.readFileSync(markdownPath, "utf-8");
    const tokenCount = estimateTokens(markdown);

    const writingModel = options.llmModelId
      ? (await db.modelConfig.findUnique({ where: { id: options.llmModelId }, include: { provider: true } })) ?? null
      : await resolveModel("writing");
    const embedModel = options.embedModelId
      ? await db.modelConfig.findUnique({ where: { id: options.embedModelId }, include: { provider: true } })
      : await resolveModel("embedding");
    const contextWindow = writingModel?.contextWindow || 4096;
    const splitRatio = options.contextUsage ? options.contextUsage / 100 : DEFAULT_SPLIT_RATIO;
    const splitThreshold = Math.floor(contextWindow * splitRatio);

    // Chunk size: cap at embedding model's context for safe embedding
    const embedContext = embedModel?.contextWindow || 8192;
    const chunkMaxTokens = Math.min(splitThreshold, Math.floor(embedContext * 0.75));

    const wordCount = markdown.split(/\s+/).length;

    await db.document.update({
      where: { id: docId },
      data: {
        markdownPath,
        markdownSize: Buffer.byteLength(markdown, "utf-8"),
        tokenEstimate: tokenCount,
        wordCount,
      },
    });

    const shouldSplit = options.autoSplit !== false && tokenCount > splitThreshold;

    if (shouldSplit) {
      await db.document.update({
        where: { id: docId },
        data: { status: "splitting" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 60 },
      });

      // Chunk size capped at embedding model limit for safe embedding
      let chunks = splitMarkdown(markdown, { maxTokens: chunkMaxTokens });

      // LLM topic merge: review section titles to group by domain (lightweight, titles only)
      const splitStrategy = options.splitStrategy || "structure-llm";
      if (splitStrategy !== "heading-only" && writingModel && chunks.length > 1) {
        try {
          await db.asyncTask.update({
            where: { id: taskId },
            data: { progress: 65 },
          });
          // 60s timeout for title-only merge (lightweight)
          const result = await Promise.race([
            semanticSplit(chunks, writingModel),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Semantic split timed out after 60s")), 60_000);
            }),
          ]);
          chunks = result.chunks;

          // Re-split large topic groups to fit embedding model limits
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

      // Clean old chunks before creating new ones
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

      await Promise.all(
        chunks.map((chunk) =>
          storage.saveChunk(docId, chunk.index, chunk.content, userId),
        ),
      );
    } else if (options.indexTarget !== "chunks") {
      // Store single-chunk representing the full document
      await db.documentChunk.deleteMany({ where: { documentId: docId } });

      const title = markdown.match(/^#\s+(.+)$/m)?.[1] || doc.originalName;
      await db.documentChunk.create({
        data: {
          documentId: docId,
          index: 0,
          title,
          content: markdown,
          tokenCount,
          headingPath: title,
        },
      });
    }

    // Embedding step (skip if indexTarget is "original")
    const indexTarget = options.indexTarget || "full";
    const needEmbedding = indexTarget !== "original";

    if (embedModel && needEmbedding) {
      await db.document.update({
        where: { id: docId },
        data: { status: "embedding" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 80 },
      });

      const allChunks = await db.documentChunk.findMany({
        where: { documentId: docId },
      });

      const provider = createLLMProvider(embedModel.provider);
      const texts = allChunks.map((c) => c.content);

      // Skip chunks that exceed model token limit to avoid embedding API errors
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

      // Use model's configured batch size, fall back to 10
      const baseBatchSize = embedModel.embeddingBatchSize || 10;
      const CONCURRENT_EMBED_BATCHES = 3;
      let totalEmbedTokens = 0;

      // Send embedding requests concurrently in groups
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

          for (let ei = 0; ei < embedResult.embeddings.length; ei++) {
            await db.documentChunk.update({
              where: { id: validChunks[start + ei].id },
              data: {
                embedding: float32ToBuffer(new Float32Array(embedResult.embeddings[ei])),
                embedModel: embedModel.modelId,
              },
            });
          }
        }
      }

      await recordTokenUsage({
        userId,
        modelConfigId: embedModel.id,
        module: "embedding",
        inputTokens: totalEmbedTokens,
        outputTokens: 0,
        referenceId: docId,
      }).catch((err) => { console.warn("Failed to record embedding token usage:", err); });
    }

    // Sync FTS5 index incrementally for this document only
    await syncFtsIndexForDocument(docId).catch((err) => { console.warn("FTS index sync failed:", err); });

    // LightRAG indexing (skip if indexTarget is "original" or "chunks")
    const needRag = indexTarget === "full";
    let indexMode = options.indexMode || "basic";
    if (indexMode === "graph" && embedModel && !isLightRAGCompatible(embedModel)) {
      console.warn(`Embedding model ${embedModel.modelId} (dim=${embedModel.embeddingDim}) not verified for LightRAG graph mode, will attempt graph extraction`);
    }
    if (needRag && embedModel) {
      await db.document.update({
        where: { id: docId },
        data: { status: "indexing" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 85 },
      });

      const ragChunksDir = storage.getDocumentDir(docId, userId);
      const ragEmbedConfig = embedModel.provider.apiKey
        ? {
            apiBase: normalizeProviderBaseUrl(embedModel.provider.apiBaseUrl),
            apiKey: decrypt(embedModel.provider.apiKey),
            model: embedModel.modelId,
          }
        : undefined;

      const ragLlmConfig = writingModel?.provider.apiKey
        ? {
            apiBase: normalizeProviderBaseUrl(writingModel.provider.apiBaseUrl),
            apiKey: decrypt(writingModel.provider.apiKey),
            model: writingModel.modelId,
          }
        : undefined;

      if (indexMode === "graph") {
        await db.asyncTask.update({
          where: { id: taskId },
          data: { progress: 87 },
        });
      }

      // Resolve embedding dimension
      const ragEmbedDim = await resolveEmbeddingDim(embedModel).catch(() => 768);

      // Use pre-computed embeddings when available to avoid duplicate API calls
      const embeddingsPath = `${outputDir}/embeddings.bin`;
      const hasCachedEmbeddings = fs.existsSync(embeddingsPath);

      const indexResult = await indexWithLightRAG(
        docId, userId, ragChunksDir, indexMode, ragEmbedDim,
        hasCachedEmbeddings ? undefined : ragEmbedConfig,
        ragLlmConfig,
        hasCachedEmbeddings ? embeddingsPath : undefined,
      ).catch((err) => {
        console.warn("LightRAG indexing failed (non-blocking):", err);
        return { status: "failed", chunks: 0, error: String(err) };
      });

      await db.asyncTask.update({
        where: { id: taskId },
        data: {
          progress: 95,
          resultData: JSON.stringify({
            rag: indexResult,
            indexMode,
          }),
        },
      });
    }

    await db.document.update({
      where: { id: docId },
      data: { status: "ready" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { status: "completed", progress: 100 },
    });
  } catch (error) {
    await db.document.update({
      where: { id: docId },
      data: { status: "failed" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Document processing failed",
      },
    });
  }
}

function splitByLinesInternal(
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
