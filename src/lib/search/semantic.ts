import path from "path";
import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { createRagContext } from "@/lib/rag/context";
import { cosineSimilarity, bufferToFloat32 } from "@/lib/documents/embedder";
import { spawnPythonJson } from "@/lib/python";
import { searchByKeyword } from "@/lib/search/fts";
import type { SearchResult } from "@/types/documents";
import type { QueryMode } from "@/lib/queue/types";

const RAG_QUERY_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_query.py");
const LIGHTRAG_404_COOLDOWN_MS = 5 * 60 * 1000;
const MIN_COSINE_THRESHOLD = 0.4;

let lightRagDisabledUntil = 0;

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
  const args = [
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
  if (embedDim > 0) args.push("--embed-dim", String(embedDim));

  const parsed: RagQueryOutput = await spawnPythonJson(RAG_QUERY_SCRIPT, args, { timeout: 60_000 });
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return {
    chunks: parsed.chunks || [],
    mode: parsed.mode || mode,
    entities: parsed.entities,
    relations: parsed.relations,
  };
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
    select: {
      id: true,
      embedding: true,
      document: { select: { id: true, originalName: true } },
    },
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
    .filter((r) => r.raw >= MIN_COSINE_THRESHOLD)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const topChunkIds = scored.map((r) => r.chunk.id);
  const topChunks = await db.documentChunk.findMany({
    where: { id: { in: topChunkIds } },
    select: { id: true, content: true, title: true },
  });
  const contentMap = new Map(topChunks.map((c) => [c.id, c]));

  return scored.map((r) => ({
    chunkId: r.chunk.id,
    documentId: r.chunk.document.id,
    documentName: r.chunk.document.originalName,
    title: contentMap.get(r.chunk.id)?.title || null,
    content: contentMap.get(r.chunk.id)?.content?.slice(0, 4000) || "",
    score: Math.round(r.raw * 1000) / 1000,
  }));
}

export async function semanticSearch(
  query: string,
  userId: string,
  limit = 20,
  mode: QueryMode = "hybrid",
): Promise<SearchResult[]> {
  let ctx: Awaited<ReturnType<typeof createRagContext>>;
  try {
    ctx = await createRagContext(userId);
  } catch {
    return [];
  }

  let semanticResults: SearchResult[] = [];

  if (ctx.llmConfig && lightRagDisabledUntil <= Date.now()) {
    try {
      const ragResults = await searchViaLightRAG(
        query,
        userId,
        limit * 2,
        mode,
        ctx.embedDim,
        ctx.embedConfig,
        ctx.llmConfig,
      );

      if (ragResults.chunks.length > 0) {
        const chunkIds = ragResults.chunks.map((r) => r.chunk_id);
        const docIds = [...new Set(chunkIds.map((rid) => rid.split("/")[0]).filter(Boolean))];

        const docs = await db.document.findMany({
          where: { id: { in: docIds } },
          select: { id: true, originalName: true },
        });
        const docMap = new Map(docs.map((d) => [d.id, { docId: d.id, docName: d.originalName }]));

        const missingContent = ragResults.chunks.filter((r) => !r.content);
        let contentFallback = new Map<string, string>();
        if (missingContent.length > 0) {
          const fallbackChunks = await db.documentChunk.findMany({
            where: { id: { in: missingContent.map((r) => r.chunk_id) } },
            select: { id: true, content: true },
          });
          contentFallback = new Map(fallbackChunks.map((c) => [c.id, c.content || ""]));
        }

        semanticResults = ragResults.chunks
          .filter((r) => r.score >= MIN_COSINE_THRESHOLD)
          .map((r) => {
            const docId = r.chunk_id.split("/")[0] || "";
            const docInfo = docMap.get(docId);
            const resolvedContent = r.content || contentFallback.get(r.chunk_id) || "";
            return {
              chunkId: r.chunk_id,
              documentId: docInfo?.docId || docId,
              documentName: docInfo?.docName || "",
              title: r.title || null,
              content: resolvedContent.slice(0, 4000),
              score: Math.round(r.score * 1000) / 1000,
            };
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("404")) {
        lightRagDisabledUntil = Date.now() + LIGHTRAG_404_COOLDOWN_MS;
        console.warn("[semantic] LightRAG unavailable (404); using direct embedding fallback for 5 minutes.");
      } else {
        console.error("[semantic] LightRAG failed:", err instanceof Error ? err.stack : err);
      }
    }
  }

  if (semanticResults.length === 0) {
    semanticResults = await searchViaDirectEmbedding(query, userId, limit * 2, ctx.embedModel.id);
  }

  let keywordResults = await searchByKeyword(query, limit * 2).catch(() => [] as SearchResult[]);

  if (keywordResults.length > 0) {
    const ids = keywordResults.map((r) => r.chunkId);
    const chunks = await db.documentChunk.findMany({
      where: { id: { in: ids } },
      select: { id: true, content: true },
    });
    const contentMap = new Map(chunks.map((c) => [c.id, c.content || ""]));
    keywordResults = keywordResults.map((r) => ({
      ...r,
      content: (contentMap.get(r.chunkId) || r.content || "").slice(0, 4000),
    }));
  }

  return rrfFuse(semanticResults, keywordResults, limit);
}

function rrfFuse(
  semantic: SearchResult[],
  keyword: SearchResult[],
  limit: number,
): SearchResult[] {
  const K = 60;
  const chunkScore = new Map<string, { result: SearchResult; score: number }>();

  semantic.forEach((r, i) => {
    const key = r.chunkId;
    const existing = chunkScore.get(key);
    const rrf = 1 / (K + i + 1);
    if (existing) {
      existing.score += rrf;
      if (rrf > existing.score * 0.5) existing.result = r;
    } else {
      chunkScore.set(key, { result: r, score: rrf });
    }
  });

  keyword.forEach((r, i) => {
    const key = r.chunkId;
    const existing = chunkScore.get(key);
    const rrf = 1 / (K + i + 1);
    if (existing) {
      existing.score += rrf;
    } else {
      chunkScore.set(key, { result: r, score: rrf });
    }
  });

  return Array.from(chunkScore.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, _i, arr) => {
      const maxScore = arr[0].score;
      const normalizedScore = maxScore > 0 ? entry.score / maxScore : 0;
      return {
        ...entry.result,
        score: Math.round(normalizedScore * 1000) / 1000,
      };
    });
}
