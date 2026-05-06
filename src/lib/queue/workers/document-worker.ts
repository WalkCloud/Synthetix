import { db } from "@/lib/db";
import { convertToMarkdown } from "@/lib/documents/converter";
import { splitMarkdown, estimateTokens } from "@/lib/documents/splitter";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { float32ToBuffer } from "@/lib/documents/embedder";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const storage = new LocalStorageAdapter();
const SPLIT_THRESHOLD = parseFloat(process.env.SPLIT_THRESHOLD || "0.5");
const RAG_INDEX_SCRIPT = path.resolve("workers/python/rag_index.py");

function indexWithLightRAG(docId: string, userId: string, chunksDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [
      RAG_INDEX_SCRIPT,
      "--doc-id", docId,
      "--user-id", userId,
      "--chunks-dir", chunksDir,
    ], { stdio: "ignore", timeout: 120_000 });

    proc.on("close", (code: number | null) => {
      code === 0 ? resolve() : reject(new Error(`LightRAG index failed with code ${code}`));
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

    const writingModel = await db.modelConfig.findFirst({
      where: { isDefaultFor: "writing" },
    });
    const contextWindow = writingModel?.contextWindow || 4096;
    const splitThreshold = Math.floor(contextWindow * SPLIT_THRESHOLD);

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

    if (tokenCount > splitThreshold) {
      await db.document.update({
        where: { id: docId },
        data: { status: "splitting" },
      });
      await db.asyncTask.update({
        where: { id: taskId },
        data: { progress: 60 },
      });

      const chunks = splitMarkdown(markdown, { maxTokens: splitThreshold });

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
    } else {
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

    const embedModel = await db.modelConfig.findFirst({
      where: { isDefaultFor: "embedding" },
      include: { provider: true },
    });

    if (embedModel) {
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
      const embedResult = await provider.embed(texts);

      for (let i = 0; i < allChunks.length; i++) {
        await db.documentChunk.update({
          where: { id: allChunks[i].id },
          data: {
            embedding: float32ToBuffer(new Float32Array(embedResult.embeddings[i])),
            embedModel: embedModel.modelId,
          },
        });
      }

      await recordTokenUsage({
        userId,
        modelConfigId: embedModel.id,
        module: "embedding",
        inputTokens: embedResult.inputTokens,
        outputTokens: 0,
        referenceId: docId,
      }).catch(() => {});
    }

    await db.document.update({
      where: { id: docId },
      data: { status: "indexing" },
    });
    await db.asyncTask.update({
      where: { id: taskId },
      data: { progress: 90 },
    });

    // LightRAG indexing
    const ragChunksDir = storage.getDocumentDir(docId, userId);
    await indexWithLightRAG(docId, userId, ragChunksDir);

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
