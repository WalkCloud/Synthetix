import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { convertToMarkdown } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens } from "@/lib/documents/splitter";
import { semanticSplit } from "@/lib/documents/semantic-splitter";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import type { ProcessingOptions } from "@/lib/queue/types";
import { spawn } from "child_process";
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
): Promise<{ status: string; chunks: number; graphEntities?: number; storage?: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const args = [
      RAG_INDEX_SCRIPT,
      "--doc-id", docId,
      "--user-id", userId,
      "--chunks-dir", chunksDir,
      "--index-mode", indexMode,
    ];
    if (embedDim > 0) {
      args.push("--embed-dim", String(embedDim));
    }
    if (embedConfig) {
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
    const proc = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: indexMode === "graph" ? 600_000 : 120_000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`LightRAG index failed: ${stderr || stdout || `code ${code}`}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        resolve(parsed);
      } catch {
        resolve({ status: "indexed", chunks: 0 });
      }
    });
    proc.on("error", (err: Error) => reject(err));
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
    const contextWindow = writingModel?.contextWindow || 4096;
    const splitRatio = options.contextUsage ? options.contextUsage / 100 : DEFAULT_SPLIT_RATIO;
    const splitThreshold = Math.floor(contextWindow * splitRatio);

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

      let chunks = splitMarkdown(markdown, { maxTokens: splitThreshold });

      // LLM semantic review (structure-llm or llm-only strategy)
      const splitStrategy = options.splitStrategy || "structure-llm";
      if (splitStrategy !== "heading-only" && writingModel) {
        try {
          await db.asyncTask.update({
            where: { id: taskId },
            data: { progress: 65 },
          });
          const result = await semanticSplit(chunks, writingModel);
          chunks = result.chunks;
        } catch {
          // Fall back to structural chunks on LLM failure
        }
      }

      // Clean old chunks before creating new ones
      await db.documentChunk.deleteMany({ where: { documentId: docId } });

      for (const chunk of chunks) {
        await db.documentChunk.create({
          data: {
            documentId: docId,
            index: chunk.index,
            title: chunk.title,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            headingPath: chunk.headingPath,
          },
        });
        await storage.saveChunk(docId, chunk.index, chunk.content, userId);
      }
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
    const embedModel = options.embedModelId
      ? await db.modelConfig.findUnique({ where: { id: options.embedModelId }, include: { provider: true } })
      : await resolveModel("embedding");

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

      const BATCH_SIZE = 64;
      let totalEmbedTokens = 0;
      for (let b = 0; b < texts.length; b += BATCH_SIZE) {
        const batch = texts.slice(b, b + BATCH_SIZE);
        const embedResult = await provider.embed(batch, embedModel.modelId);
        totalEmbedTokens += embedResult.inputTokens;

        for (let i = 0; i < batch.length; i++) {
          await db.documentChunk.update({
            where: { id: allChunks[b + i].id },
            data: {
              embedding: float32ToBuffer(new Float32Array(embedResult.embeddings[i])),
              embedModel: embedModel.modelId,
            },
          });
        }
      }

      await recordTokenUsage({
        userId,
        modelConfigId: embedModel.id,
        module: "embedding",
        inputTokens: totalEmbedTokens,
        outputTokens: 0,
        referenceId: docId,
      }).catch(() => {});
    }

    // LightRAG indexing (skip if indexTarget is "original" or "chunks")
    const needRag = indexTarget === "full";
    const indexMode = options.indexMode || "basic";
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
            apiBase: embedModel.provider.apiBaseUrl
              .replace(/\/embeddings?$/, "")
              .replace(/\/chat\/completions$/, ""),
            apiKey: decrypt(embedModel.provider.apiKey),
            model: embedModel.modelId,
          }
        : undefined;

      const ragLlmConfig = writingModel?.provider.apiKey
        ? {
            apiBase: writingModel.provider.apiBaseUrl
              .replace(/\/embeddings?$/, "")
              .replace(/\/chat\/completions$/, ""),
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

      const indexResult = await indexWithLightRAG(
        docId, userId, ragChunksDir, indexMode, ragEmbedDim, ragEmbedConfig, ragLlmConfig,
      ).catch((err) => {
        // LightRAG indexing failure is non-blocking — direct DB embeddings still work
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
