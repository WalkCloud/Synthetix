/**
 * In-process LRU cache for query-time embeddings.
 *
 * The direct-embedding baseline branch embeds the user's query text via an
 * external API (~450ms per call). Identical or near-identical queries are
 * common during iterative search sessions, so caching the resulting vector
 * eliminates the network round-trip on repeats — dropping the direct path
 * from ~479ms to ~30ms.
 *
 * Follows the same module-level Map + TTL + LRU-eviction pattern as
 * `graph-cache.ts` and `resolve-model.ts`.
 */

interface CacheEntry {
  embedding: Float32Array;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const MAX_ENTRIES = 256;

const CACHE = new Map<string, CacheEntry>();

function buildKey(userId: string, modelId: string, query: string): string {
  // Normalize whitespace so "  foo  bar  " and "foo bar" share a cache entry.
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
  return `${userId}|${modelId}|${normalized}`;
}

/**
 * Returns the cached query embedding if present and not expired, otherwise
 * undefined. Refreshes LRU recency on hit (delete-then-re-set preserves
 * insertion order in JS Maps).
 */
export function getQueryEmbedding(
  userId: string,
  modelId: string,
  query: string,
): Float32Array | undefined {
  const key = buildKey(userId, modelId, query);
  const entry = CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return undefined;
  }
  // Refresh recency.
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry.embedding;
}

/**
 * Stores a query embedding, evicting the least-recently-used entry first if
 * at capacity. The Float32Array is stored by reference — callers must not
 * mutate it after caching.
 */
export function setQueryEmbedding(
  userId: string,
  modelId: string,
  query: string,
  embedding: Float32Array,
): void {
  const key = buildKey(userId, modelId, query);
  while (CACHE.size >= MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
  CACHE.set(key, { embedding, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Invalidate all cached embeddings for a specific user. */
export function invalidateUserQueryEmbeddings(userId: string): void {
  const prefix = `${userId}|`;
  for (const key of CACHE.keys()) {
    if (key.startsWith(prefix)) CACHE.delete(key);
  }
}

/** Clear the entire cache. Intended for tests. */
export function clearQueryEmbeddingCache(): void {
  CACHE.clear();
}
