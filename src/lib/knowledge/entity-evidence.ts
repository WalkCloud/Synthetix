/**
 * Fast entity-evidence lookup — direct read of LightRAG's KV stores.
 *
 * The previous implementation called `semanticSearch(entity, userId, 8, "mix")`,
 * which went through the Python daemon (60s startup timeout) → spawn fallback
 * (cold Python + lightrag import + mix-mode keyword-extraction LLM call),
 * averaging 28-68s per query. But "which chunks mention entity X?" is a direct
 * lookup, not a semantic search:
 *
 *   data/rag/<userId>/kv_store_entity_chunks.json  → { entity: { chunk_ids: [...] } }
 *   data/rag/<userId>/kv_store_text_chunks.json    → { chunk_id: { content, ... } }
 *
 * Both files are written by LightRAG on every index and are the canonical
 * entity→chunk mapping (the same source the LightRAG adapter
 * purge_application_document uses for source-aware deletion). Reading them
 * directly gives sub-100ms evidence lookups with no LLM, no embedding, no Python.
 *
 * Cache: parsed JSON is memoized per user with an mtime check. The files only
 * change on index/delete (both go through `invalidateEntityEvidenceCache`),
 * so a 30s TTL would also be safe — but mtime is strictly correct and free.
 */
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import type { SearchResult } from "@/types/documents";
import { resolveRagRoot } from "@/lib/rag/paths";

const RAG_ROOT = resolveRagRoot();
const ENTITY_CHUNKS_FILE = "kv_store_entity_chunks.json";
const TEXT_CHUNKS_FILE = "kv_store_text_chunks.json";

interface EntityChunksValue {
  chunk_ids?: string[];
}
type EntityChunksStore = Record<string, EntityChunksValue>;

interface TextChunkValue {
  content?: string;
  tokens?: number;
  chunk_order_index?: number;
  full_doc_id?: string;
}
type TextChunksStore = Record<string, TextChunkValue>;

interface CacheEntry {
  mtimeMs: number;
  data: EntityChunksStore | TextChunksStore;
}
const entityChunksCache = new Map<string, CacheEntry>();
const textChunksCache = new Map<string, CacheEntry>();

/** Resolve the per-user RAG working dir. Matches rag_index.py:272. */
function ragDir(userId: string): string {
  return path.join(RAG_ROOT, userId);
}

/**
 * Read + parse a JSON KV file, memoizing by (userId, file mtime). The file only
 * changes when LightRAG writes it (index/delete), so this is safe to cache.
 * Returns {} on missing/invalid file (fresh index, no entities yet).
 */
async function loadKvStore<T extends EntityChunksStore | TextChunksStore>(
  userId: string,
  fileName: string,
  cache: Map<string, CacheEntry>,
): Promise<T> {
  const filePath = path.join(ragDir(userId), fileName);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return {} as T;
  }
  const cached = cache.get(userId);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.data as T;
  }
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as T;
    cache.set(userId, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch {
    return {} as T;
  }
}

/** Drop cached KV reads for a user. Call after index/delete/mutation. */
export function invalidateEntityEvidenceCache(userId: string): void {
  entityChunksCache.delete(userId);
  textChunksCache.delete(userId);
}

/**
 * Extract the documentId prefix from a LightRAG chunk_id.
 * Chunk ids are formatted `<docId>/chunk_NNN-chunk-XXX` (rag_index.py:547).
 * Returns the prefix before the first "/", or "" if malformed.
 */
export function docIdFromChunkId(chunkId: string): string {
  const idx = chunkId.indexOf("/");
  return idx > 0 ? chunkId.slice(0, idx) : "";
}

/**
 * Find the chunk_ids for an entity, supporting exact + fuzzy matches.
 *
 * LightRAG stores entity names verbatim from the LLM extraction prompt, which
 * preserves case and source-language characters. The frontend entity-evidence
 * caller passes the entity name URL-decoded from the route. We try exact first
 * (the common path), then fall back to case-insensitive + substring matching
 * so a query for "k8s" still finds "Kubernetes" if the entity was extracted as
 * "Kubernetes (k8s)". Aggregates all matches' chunk_ids, deduped, preserving
 * first-seen order so the most-relevant (exact-match) chunks come first.
 */
export function resolveEntityChunkIds(
  entityChunks: EntityChunksStore,
  entity: string,
  maxChunks = 8,
): string[] {
  const target = entity.trim();
  if (!target) return [];

  // 1. Exact match (fast path).
  const exact = entityChunks[target];
  if (exact?.chunk_ids?.length) {
    return exact.chunk_ids.slice(0, maxChunks);
  }

  // 2. Case-insensitive exact match.
  const lower = target.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [name, meta] of Object.entries(entityChunks)) {
    if (name.toLowerCase() === lower) {
      for (const cid of meta.chunk_ids ?? []) {
        if (!seen.has(cid)) {
          seen.add(cid);
          out.push(cid);
          if (out.length >= maxChunks) return out;
        }
      }
    }
  }
  if (out.length > 0) return out;

  // 3. Substring match (entity name contains target, or target contains name).
  //    Catches "k8s" → "Kubernetes (k8s)" style aliases.
  for (const [name, meta] of Object.entries(entityChunks)) {
    const n = name.toLowerCase();
    if (n.includes(lower) || lower.includes(n)) {
      for (const cid of meta.chunk_ids ?? []) {
        if (!seen.has(cid)) {
          seen.add(cid);
          out.push(cid);
          if (out.length >= maxChunks) return out;
        }
      }
    }
  }
  return out;
}

export interface EntityEvidenceChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  title: string | null;
  content: string;
  score: number;
  source: string;
}

export interface EntityEvidenceResult {
  entity: string;
  documentChunks: EntityEvidenceChunk[];
  /** True when evidence came from the KV-store fast path; false if the caller
   * should fall back to semanticSearch (entity not in graph, no RAG data, etc). */
  fromCache: boolean;
}

/**
 * Resolve entity evidence directly from LightRAG's KV stores. Returns
 * `{ fromCache: false }` semantics via throwing `EntityNotInGraphError` when
 * the fast path can't answer (entity not found / no RAG data), so the caller
 * can fall back to the semantic-search path.
 */
export async function getEntityEvidenceFromKv(
  userId: string,
  entity: string,
  limit = 8,
): Promise<EntityEvidenceResult> {
  const entityChunks = await loadKvStore<EntityChunksStore>(userId, ENTITY_CHUNKS_FILE, entityChunksCache);
  // No file yet = fresh index, no graph built. Signal fallback.
  if (Object.keys(entityChunks).length === 0) {
    throw new EntityNotInGraphError("entity-chunks store is empty");
  }

  const chunkIds = resolveEntityChunkIds(entityChunks, entity, limit);
  if (chunkIds.length === 0) {
    throw new EntityNotInGraphError(`entity ${entity!} not found in graph`);
  }

  const textChunks = await loadKvStore<TextChunksStore>(userId, TEXT_CHUNKS_FILE, textChunksCache);

  // Resolve document names in one batched query (one DB hit per request).
  const docIds = [...new Set(chunkIds.map(docIdFromChunkId).filter(Boolean))];
  const docs = docIds.length > 0
    ? await db.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, originalName: true },
      })
    : [];
  const docNameById = new Map(docs.map((d) => [d.id, d.originalName]));

  const documentChunks: EntityEvidenceChunk[] = chunkIds.map((chunkId) => {
    const docId = docIdFromChunkId(chunkId);
    const stored = textChunks[chunkId];
    const content = stored?.content ?? "";
    return {
      chunkId,
      documentId: docId,
      documentName: docNameById.get(docId) ?? "",
      // LightRAG chunks don't carry a separate title field; the heading path
      // is embedded in the content prefix. Leave null — frontend already
      // builds excerpts from content.
      title: null,
      content,
      // Score is meaningless for a direct lookup (everything matched the
      // entity exactly). Use 1.0 so the UI's "high relevance" bucket applies.
      score: 1.0,
      source: "entity_lookup",
    };
  });

  return { entity, documentChunks, fromCache: true };
}

/** Thrown when the KV fast path can't answer — caller falls back to semantic search. */
export class EntityNotInGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntityNotInGraphError";
  }
}

/**
 * Adapt an `EntityEvidenceResult` to the `SearchResult[]` shape the route
 * previously returned, so the frontend contract is unchanged. Used only when
 * falling back to semanticSearch — the canonical path returns documentChunks
 * directly.
 *
 * Source is mapped to "lightrag" (the closest existing SearchResultSource
 * bucket) since the data originates from LightRAG's KV store.
 */
export function evidenceChunksToSearchResults(chunks: EntityEvidenceChunk[]): SearchResult[] {
  return chunks.map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentName: c.documentName,
    title: c.title,
    content: c.content,
    score: c.score,
    source: "lightrag",
    relevanceLabel: "high",
    debug: { entityLookup: true } as SearchResult["debug"],
  }));
}
