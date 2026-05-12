import { spawn } from "child_process";
import path from "path";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { resolveModel } from "@/lib/llm/resolve-model";
import { createLLMProvider } from "@/lib/llm/factory";
import { resolveEmbeddingDim } from "@/lib/rag/dimension";
import { cosineSimilarity, bufferToFloat32 } from "@/lib/documents/embedder";
import type { SearchResult } from "@/types/documents";
import type { QueryMode } from "@/lib/queue/types";

const RAG_QUERY_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_query.py");
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

interface RagChunkResult {
  chunk_id: string;
  content: string;
  title: string;
  score: number;
}

interface RagQueryOutput {
  chunks: RagChunkResult[];
  mode: string;
  total_chunks: number;
  entities?: Array<{ entity_name: string; entity_type: string; description: string }>;
  relations?: Array<{ source_entity: string; target_entity: string; description: string; weight: number }>;
  error?: string;
}

async function searchViaLightRAG(
  query: string,
  userId: string,
  limit: number,
  mode: QueryMode,
  embedDim: number,
  embedConfig: { apiBase: string; apiKey: string; model: string },
  llmConfig: { apiBase: string; apiKey: string; model: string },
): Promise<{ chunks: RagChunkResult[]; mode: string; entities?: unknown[]; relations?: unknown[] }> {
  return new Promise((resolve, reject) => {
    const args = [
      RAG_QUERY_SCRIPT,
      "--user-id", userId,
      "--query", query,
      "--mode", mode,
      "--limit", String(limit),
      "--embed-api-base", embedConfig.apiBase,
      "--embed-api-key", embedConfig.apiKey,
      "--embed-model", embedConfig.model,
      "--llm-api-base", llmConfig.apiBase,
      "--llm-api-key", llmConfig.apiKey,
      "--llm-model", llmConfig.model,
    ];
    if (embedDim > 0) {
      args.push("--embed-dim", String(embedDim));
    }

    const proc = spawn(PYTHON_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`LightRAG query failed: ${stderr || stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) { resolve({ chunks: [], mode, entities: [], relations: [] }); return; }
      try {
        const parsed: RagQueryOutput = JSON.parse(trimmed);
        if (parsed.error) {
          reject(new Error(parsed.error));
        } else {
          resolve({
            chunks: parsed.chunks || [],
            mode: parsed.mode || mode,
            entities: parsed.entities,
            relations: parsed.relations,
          });
        }
      } catch {
        resolve({ chunks: [], mode, entities: [], relations: [] });
      }
    });

    proc.on("error", (err: Error) => {
      reject(err);
    });
  });
}

async function searchViaDirectEmbedding(
  query: string,
  userId: string,
  limit: number,
  embedModelId: string,
): Promise<SearchResult[]> {
  const embedModel = await db.modelConfig.findUnique({
    where: { id: embedModelId },
    include: { provider: true },
  });
  if (!embedModel) return [];

  const provider = createLLMProvider(embedModel.provider);
  const embedResult = await provider.embed([query], embedModel.modelId);
  const queryEmbedding = new Float32Array(embedResult.embeddings[0]);

  const chunks = await db.documentChunk.findMany({
    where: {
      embedding: { not: null },
      document: { userId },
    },
    include: { document: { select: { id: true, originalName: true } } },
    take: 500,
  });

  if (chunks.length === 0) return [];

  const scored = chunks
    .map((chunk) => {
      if (!chunk.embedding) return null;
      const chunkEmb = bufferToFloat32(new Uint8Array(chunk.embedding));
      const raw = cosineSimilarity(queryEmbedding, chunkEmb);
      return { chunk, raw };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const minRaw = scored[scored.length - 1].raw;
  const maxRaw = scored[0].raw;
  const range = maxRaw - minRaw || 1;

  return scored.map((r, i) => {
    const normalized = range > 0.01
      ? 0.7 + 0.3 * ((r.raw - minRaw) / range)
      : 0.7 + 0.3 * (1 - i / Math.max(scored.length - 1, 1));
    return {
      chunkId: r.chunk.id,
      documentId: r.chunk.document.id,
      documentName: r.chunk.document.originalName,
      title: r.chunk.title,
      content: r.chunk.content.slice(0, 500),
      score: Math.round(normalized * 1000) / 1000,
    };
  });
}

export async function semanticSearch(
  query: string,
  userId: string,
  limit = 20,
  mode: QueryMode = "hybrid",
): Promise<SearchResult[]> {
  // Resolve embed and LLM configs from DB
  const [embedModel, llmModel] = await Promise.all([
    resolveModel("embedding"),
    resolveModel("writing"),
  ]);

  if (!embedModel) {
    throw new Error("No embedding model configured. Add one in Model Management.");
  }

  // Try LightRAG first (requires LLM + embed configs)
  if (llmModel?.provider.apiKey && embedModel.provider.apiKey) {
    try {
      const embedDim = await resolveEmbeddingDim(embedModel).catch(() => 0);
      const ragResults = await searchViaLightRAG(
        query,
        userId,
        limit,
        mode,
        embedDim,
        {
          apiBase: embedModel.provider.apiBaseUrl
            .replace(/\/embeddings?$/, "")
            .replace(/\/chat\/completions$/, ""),
          apiKey: decrypt(embedModel.provider.apiKey),
          model: embedModel.modelId,
        },
        {
          apiBase: llmModel.provider.apiBaseUrl
            .replace(/\/embeddings?$/, "")
            .replace(/\/chat\/completions$/, ""),
          apiKey: decrypt(llmModel.provider.apiKey),
          model: llmModel.modelId,
        },
      );

      if (ragResults.chunks.length > 0) {
        const chunkIds = ragResults.chunks.map((r) => r.chunk_id);
        const docIds = [...new Set(chunkIds.map((rid) => rid.split("/")[0]).filter(Boolean))];

        const docs = await db.document.findMany({
          where: { id: { in: docIds } },
          select: { id: true, originalName: true },
        });
        const docMap = new Map(docs.map((d) => [d.id, { docId: d.id, docName: d.originalName }]));

        return ragResults.chunks.map((r) => {
          const docId = r.chunk_id.split("/")[0] || "";
          const docInfo = docMap.get(docId);
          return {
            chunkId: r.chunk_id,
            documentId: docInfo?.docId || docId,
            documentName: docInfo?.docName || "",
            title: r.title || null,
            content: r.content,
            score: r.score,
          };
        });
      }
    } catch (err) {
      console.error("[semantic] LightRAG failed:", err instanceof Error ? err.stack : err);
    }
  }

  // Fallback: direct embedding cosine similarity
  return searchViaDirectEmbedding(query, userId, limit, embedModel.id);
}
