import path from "path";
import { db } from "@/lib/db";
import { createLLMProvider } from "@/lib/llm/factory";
import { recordTokenUsage } from "@/lib/llm/usage";
import { createRagContext } from "@/lib/rag/context";
import { cosineSimilarity, bufferToFloat32 } from "@/lib/documents/embedder";
import { spawnPythonJson } from "@/lib/python";
import { pythonDaemon, isDaemonEnabled } from "@/lib/python-daemon";
import { searchByKeyword } from "@/lib/search/fts";
import { buildSearchExcerpt } from "@/lib/search/excerpt";
import type { SearchResult, SearchRerankStatus } from "@/types/documents";
import type { QueryMode } from "@/lib/queue/types";

const RAG_QUERY_SCRIPT = path.resolve(/* turbopackIgnore: true */ "workers/python/rag_query.py");
// Daemon queries reuse a resident LightRAG instance after the first call per
// user. The first daemon call pays the lightrag import + storage load + a
// query-time LLM round-trip (mix/hybrid do keyword extraction), which can
// itself take a while. We DON'T want a cold daemon to block the user for the
// full 90s before falling back — a short daemon timeout makes the cold path
// fail fast to spawn, while the daemon keeps warming in the background so the
// NEXT query hits a resident instance. Once warm, real queries finish in 1-3s
// well under this ceiling.
// Daemon queries reuse a resident LightRAG instance after the first call per
// user. The first call pays lightrag import + storage load + an embedding API
// round-trip (~2s in practice); subsequent calls hit the cached instance and
// finish in <1s. 60s gives headroom for a transiently slow embedding API
// without the aggressive 90s-then-kill that the old spawn path used.
const RAG_QUERY_DAEMON_TIMEOUT_MS = 60_000;
const LIGHTRAG_404_COOLDOWN_MS = 5 * 60 * 1000;
const LIGHTRAG_NO_DATA_COOLDOWN_MS = 30 * 60 * 1000;
const LIGHTRAG_INDEXING_COOLDOWN_MS = 5 * 60 * 1000;
const MIN_COSINE_THRESHOLD = 0.55;

function stripSearchMarkup(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

const lightRagCooldowns = new Map<string, number>();

interface RagChunkResult {
  chunk_id: string;
  content: string;
  title: string;
  score: number;
  rank?: number;
  vector_score?: number | null;
}

interface RagQueryOutput {
  chunks: RagChunkResult[];
  mode: string;
  total_chunks: number;
  entities?: Array<{ entity_name: string; entity_type: string; description: string }>;
  relations?: Array<{ source_entity: string; target_entity: string; description: string; weight: number }>;
  error?: string;
}

export function mapRagChunkToSearchResult(input: {
  chunk: RagChunkResult;
  query: string;
  mode: QueryMode;
  docName: string;
  docId: string;
  rerank: SearchRerankStatus;
}): SearchResult {
  const vectorScore = typeof input.chunk.vector_score === "number" ? input.chunk.vector_score : undefined;
  const score = typeof vectorScore === "number" ? vectorScore : Math.min(input.chunk.score, 0.75);
  return {
    chunkId: input.chunk.chunk_id,
    documentId: input.docId,
    documentName: input.docName,
    title: input.chunk.title || null,
    content: buildSearchExcerpt(input.chunk.content || "", input.query, 360),
    score: Math.round(score * 1000) / 1000,
    rank: input.chunk.rank,
    source: "lightrag",
    relevanceLabel: score >= 0.8 ? "high" : score >= 0.6 ? "medium" : "low",
    debug: {
      semanticRank: input.chunk.rank,
      vectorScore,
      mode: input.mode,
      rerank: input.rerank,
    },
  };
}

/**
 * Build the kwargs dict shared by both the daemon and the spawn fallback.
 * Daemon mode passes these as a JSON `params` object; spawn mode flattens them
 * to CLI flags. Keeping construction in one place prevents drift.
 */
function buildRagQueryParams(
  query: string,
  userId: string,
  limit: number,
  mode: QueryMode,
  embedDim: number,
  embedConfig: { apiBase: string; apiKey: string; model: string },
  llmConfig: { apiBase: string; apiKey: string; model: string },
  rerankConfig?: { apiBase: string; apiKey: string; model: string },
): Record<string, unknown> {
  return {
    user_id: userId,
    query_text: query,
    mode,
    limit,
    embed_api_base: embedConfig.apiBase,
    embed_api_key: embedConfig.apiKey,
    embed_model: embedConfig.model,
    embed_dim: embedDim,
    llm_api_base: llmConfig.apiBase,
    llm_api_key: llmConfig.apiKey,
    llm_model: llmConfig.model,
    rerank_api_base: rerankConfig?.apiBase ?? "",
    rerank_api_key: rerankConfig?.apiKey ?? "",
    rerank_model: rerankConfig?.model ?? "",
  };
}

async function searchViaLightRAG(
  query: string,
  userId: string,
  limit: number,
  mode: QueryMode,
  embedDim: number,
  embedConfig: { apiBase: string; apiKey: string; model: string },
  llmConfig: { apiBase: string; apiKey: string; model: string },
  rerankConfig?: { apiBase: string; apiKey: string; model: string },
): Promise<{ chunks: RagChunkResult[]; mode: string; entities?: unknown[]; relations?: unknown[] }> {
  // Preferred path: the long-lived daemon. After the first query per user it
  // reuses a resident LightRAG instance, skipping interpreter start, lightrag
  // import, the full-directory JSON/GraphML integrity scan, and storage load.
  // Falls back transparently to a one-shot spawn if the daemon is disabled or
  // errors — callers see identical output shape either way.
  if (isDaemonEnabled()) {
    try {
      const params = buildRagQueryParams(query, userId, limit, mode, embedDim, embedConfig, llmConfig, rerankConfig);
      const parsed = await pythonDaemon.call<RagQueryOutput>("query", params, {
        timeoutMs: RAG_QUERY_DAEMON_TIMEOUT_MS,
      });
      if (parsed.error) throw new Error(parsed.error);
      return {
        chunks: parsed.chunks || [],
        mode: parsed.mode || mode,
        entities: parsed.entities,
        relations: parsed.relations,
      };
    } catch (err) {
      // Don't let a daemon hiccup (cold start, OOM restart, transient error)
      // surface to the user — the spawn fallback produces the same result.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[semantic] daemon query failed, falling back to spawn:", msg);
    }
  }

  const params = buildRagQueryParams(query, userId, limit, mode, embedDim, embedConfig, llmConfig, rerankConfig);
  const args: string[] = [
    "--user-id", String(params.user_id),
    "--query", String(params.query_text),
    "--mode", String(params.mode),
    "--limit", String(params.limit),
    "--embed-api-base", String(params.embed_api_base),
    "--embed-api-key", String(params.embed_api_key),
    "--embed-model", String(params.embed_model),
    "--llm-api-base", String(params.llm_api_base),
    "--llm-api-key", String(params.llm_api_key),
    "--llm-model", String(params.llm_model),
    "--rerank-api-base", String(params.rerank_api_base),
    "--rerank-api-key", String(params.rerank_api_key),
    "--rerank-model", String(params.rerank_model),
  ];
  if (Number(params.embed_dim) > 0) args.push("--embed-dim", String(params.embed_dim));

  // 90s ceiling gives rag_query's bounded-retry LLM path (per-call 25s × 2
  // attempts) headroom. Normal hybrid/mix queries finish far sooner; this is
  // only the safety ceiling so a transiently slow LLM doesn't trip a hard kill.
  const parsed: RagQueryOutput = await spawnPythonJson(RAG_QUERY_SCRIPT, args, { timeout: 90_000 });
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
): Promise<{ results: SearchResult[]; inputTokens: number }> {
  const embedModel = await db.modelConfig.findUnique({
    where: { id: embedModelId },
    include: { provider: true },
  });
  if (!embedModel) return { results: [], inputTokens: 0 };

  const provider = createLLMProvider(embedModel.provider);
  const embedResult = await provider.embed([query], embedModel.modelId);
  const embedTokens = embedResult.inputTokens ?? 0;
  const queryEmbedding = new Float32Array(embedResult.embeddings[0]);

  const totalCount = await db.documentChunk.count({
    where: {
      embedding: { not: null },
      document: { userId },
    },
  });
  const take = Math.min(totalCount, 2000);
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
    take,
  });

  if (chunks.length === 0) return { results: [], inputTokens: embedTokens };

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

  if (scored.length === 0) return { results: [], inputTokens: embedTokens };

  const topChunkIds = scored.map((r) => r.chunk.id);
  const topChunks = await db.documentChunk.findMany({
    where: { id: { in: topChunkIds } },
    select: { id: true, content: true, title: true },
  });
  const contentMap = new Map(topChunks.map((c) => [c.id, c]));

  return { results: scored.map((r) => ({
    chunkId: r.chunk.id,
    documentId: r.chunk.document.id,
    documentName: r.chunk.document.originalName,
    title: contentMap.get(r.chunk.id)?.title || null,
    content: buildSearchExcerpt(contentMap.get(r.chunk.id)?.content || "", query, 360),
    score: Math.round(r.raw * 1000) / 1000,
    source: "direct_embedding",
    relevanceLabel: r.raw >= 0.8 ? "high" : r.raw >= 0.6 ? "medium" : "low",
    debug: { vectorScore: Math.round(r.raw * 1000) / 1000 },
  })), inputTokens: embedTokens };
}

/**
 * Run the keyword (FTS5) branch and resolve full content for its hits.
 * Independent of the semantic branch — run in parallel with it.
 */
async function runKeywordBranch(
  query: string,
  userId: string,
  limit: number,
): Promise<SearchResult[]> {
  let keywordResults = await searchByKeyword(query, userId, limit).catch(() => [] as SearchResult[]);
  if (keywordResults.length === 0) return [];

  const ids = keywordResults.map((r) => r.chunkId);
  const chunks = await db.documentChunk.findMany({
    where: { id: { in: ids } },
    select: { id: true, content: true },
  });
  const contentMap = new Map(chunks.map((c) => [c.id, c.content || ""]));
  return keywordResults.map((r) => ({
    ...r,
    content: buildSearchExcerpt(contentMap.get(r.chunkId) || r.content || "", query, 360),
    source: r.source || "keyword",
    relevanceLabel: r.relevanceLabel || "keyword",
    debug: { ...r.debug, keywordScore: r.score },
  }));
}

export async function semanticSearch(
  query: string,
  userId: string,
  limit = 20,
  mode: QueryMode = "mix",
): Promise<SearchResult[]> {
  let ctx: Awaited<ReturnType<typeof createRagContext>>;
  try {
    ctx = await createRagContext(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[semantic] Failed to create RAG context:", message);
    throw new Error(`Semantic search unavailable: ${message}`);
  }

  // Semantic + keyword branches are independent (different retrieval engines,
  // different data sources) — run them in parallel and fuse with RRF when both
  // resolve. The keyword branch used to be `await`ed AFTER the semantic branch,
  // which added its full latency (incl. a possible first-call FTS rebuild) on
  // top of the LightRAG query. Parallelizing hides it behind the slower branch.
  const semanticPromise = runSemanticBranch(query, userId, limit, mode, ctx);
  const keywordPromise = runKeywordBranch(query, userId, limit * 2);

  const [semanticResults, keywordResults] = await Promise.all([semanticPromise, keywordPromise]);

  const results = rrfFuse(semanticResults, keywordResults, limit, query);

  // Attach images. Previously this looped every result and ran
  // allImages.filter(...) inside — O(results × images). Build the index once
  // so each lookup is O(1).
  const matchedDocIds = [...new Set(results.map((r) => r.documentId))];
  if (matchedDocIds.length > 0) {
    const allImages = await db.documentImage.findMany({
      where: { documentId: { in: matchedDocIds } },
    });
    if (allImages.length > 0) {
      const imagesByDoc = new Map<string, typeof allImages>();
      for (const img of allImages) {
        const list = imagesByDoc.get(img.documentId);
        if (list) list.push(img);
        else imagesByDoc.set(img.documentId, [img]);
      }
      for (const result of results) {
        const docImages = imagesByDoc.get(result.documentId);
        if (docImages && docImages.length > 0) {
          result.images = docImages.map((img) => ({
            id: img.id,
            documentId: img.documentId,
            filename: img.filename,
            url: `/api/v1/documents/${img.documentId}/images/${img.filename}`,
            altText: img.altText,
            mimeType: img.mimeType,
            fileSize: img.fileSize,
            width: img.width,
            height: img.height,
            pageNumber: img.pageNumber,
          }));
        }
      }
    }
  }

  return results;
}

/**
 * Semantic branch: try LightRAG (daemon first, spawn fallback inside), and on
 * empty/failed LightRAG fall back to direct embedding scan. Returns the
 * semantic result list — never throws (failures land in the direct-embedding
 * fallback or return []).
 */
async function runSemanticBranch(
  query: string,
  userId: string,
  limit: number,
  mode: QueryMode,
  ctx: Awaited<ReturnType<typeof createRagContext>>,
): Promise<SearchResult[]> {
  let semanticResults: SearchResult[] = [];

  if (ctx.llmConfig && (lightRagCooldowns.get(userId) ?? 0) <= Date.now()) {
    try {
      const ragResults = await searchViaLightRAG(
        query,
        userId,
        limit * 2,
        mode,
        ctx.embedDim,
        ctx.embedConfig,
        ctx.llmConfig,
        ctx.rerankConfig,
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

        const rerankStatus: SearchRerankStatus = ctx.rerankConfig ? "enabled" : "missing";
        semanticResults = ragResults.chunks
          .map((r) => {
            const docId = r.chunk_id.split("/")[0] || "";
            const docInfo = docMap.get(docId);
            const resolvedContent = r.content || contentFallback.get(r.chunk_id) || "";
            return mapRagChunkToSearchResult({
              chunk: { ...r, content: resolvedContent },
              query,
              mode,
              docId: docInfo?.docId || docId,
              docName: docInfo?.docName || "",
              rerank: rerankStatus,
            });
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("data unavailable") || message.includes("no data indexed") || message.includes("empty index")) {
        lightRagCooldowns.set(userId, Date.now() + LIGHTRAG_NO_DATA_COOLDOWN_MS);
      } else if (message.includes("indexing in progress")) {
        lightRagCooldowns.set(userId, Date.now() + LIGHTRAG_INDEXING_COOLDOWN_MS);
      } else if (message.includes("404")) {
        lightRagCooldowns.set(userId, Date.now() + LIGHTRAG_404_COOLDOWN_MS);
      } else if (message.includes("<timeout after")) {
        // A timeout (daemon or spawn) is almost always a slow query-time LLM
        // (mix/hybrid keyword extraction), NOT a data problem. Cooldown would
        // suppress LightRAG for 5min and force every search onto the direct-
        // embedding fallback — wrong call for a transient slow LLM. Log and
        // move on; the next query will retry LightRAG immediately.
        console.error("[semantic] LightRAG query timed out for user", userId, "(likely slow LLM, no cooldown set)");
      } else {
        lightRagCooldowns.set(userId, Date.now() + LIGHTRAG_404_COOLDOWN_MS);
        console.error("[semantic] LightRAG query failed for user", userId, err instanceof Error ? err.stack : err);
      }
    }
  }

  if (semanticResults.length === 0) {
    const direct = await searchViaDirectEmbedding(query, userId, limit * 2, ctx.embedModel.id);
    semanticResults = direct.results;
    if (direct.inputTokens > 0) {
      await recordTokenUsage({
        userId,
        modelConfigId: ctx.embedModel.id,
        module: "search",
        inputTokens: direct.inputTokens,
        outputTokens: 0,
      }).catch(() => {});
    }
  }

  return semanticResults;
}

function rrfFuse(
  semantic: SearchResult[],
  keyword: SearchResult[],
  limit: number,
  query = "",
): SearchResult[] {
  const K = 20;
  const semanticWeight = 1.0;
  const keywordWeight = 1.35;
  const byChunk = new Map<string, { result: SearchResult; score: number }>();

  const exactPhraseBoost = (result: SearchResult): number => {
    const q = query.trim();
    if (!q) return 0;
    const haystack = `${result.title || ""}\n${result.content || ""}`;
    if ((result.title || "").includes(q)) return 0.14;
    const exactIndex = haystack.indexOf(q);
    if (exactIndex >= 0 && exactIndex <= 120) return 0.12;
    if (exactIndex >= 0 && exactIndex <= 300) return 0.08;
    if (exactIndex >= 0) return 0.03;
    const terms = q.match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9_-]+/g) || [];
    if (terms.length > 0 && terms.every((term) => haystack.includes(term))) return 0.03;
    return 0;
  };

  const add = (results: SearchResult[], weight: number, kind: "semantic" | "keyword") => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const cleanResult: SearchResult = {
        ...r,
        content: stripSearchMarkup(r.content || ""),
      };
      const rankContribution = weight * (1 / (K + i + 1));
      const scoreContribution = Math.max(0, Math.min(1, cleanResult.score || 0)) * 0.01;
      const phraseBoost = exactPhraseBoost(cleanResult);
      const contribution = rankContribution + scoreContribution + phraseBoost;
      const existing = byChunk.get(cleanResult.chunkId);
      const base = existing?.result || cleanResult;
      const visibleScore = kind === "semantic"
        ? Math.min(1, Math.max(0, (cleanResult.score || 0) + phraseBoost))
        : cleanResult.score;
      const merged: SearchResult = {
        ...base,
        score: kind === "semantic" || !existing ? Math.max(base.score || 0, visibleScore || 0) : base.score,
        source: existing ? "fused" : (kind === "keyword" ? "keyword" : cleanResult.source || "lightrag"),
        debug: {
          ...base.debug,
          ...(kind === "semantic" ? { semanticRank: i + 1 } : { keywordRank: i + 1, keywordScore: cleanResult.score }),
          fusionScore: Math.round(((existing?.score || 0) + contribution) * 1000) / 1000,
        },
      };
      byChunk.set(cleanResult.chunkId, { result: merged, score: (existing?.score || 0) + contribution });
    }
  };

  add(semantic, semanticWeight, "semantic");
  add(keyword, keywordWeight, "keyword");

  return Array.from(byChunk.values())
    .sort((a, b) => (b.result.score || 0) - (a.result.score || 0) || b.score - a.score)
    .slice(0, limit)
    .map((entry, idx) => ({
      ...entry.result,
      rank: idx + 1,
      source: entry.result.source || "fused",
      relevanceLabel: entry.result.relevanceLabel || (entry.result.score >= 0.8 ? "high" : entry.result.score >= 0.6 ? "medium" : "low"),
      debug: { ...entry.result.debug, fusionScore: Math.round(entry.score * 1000) / 1000 },
    }));
}

export const rrfFuseForTest = rrfFuse;
