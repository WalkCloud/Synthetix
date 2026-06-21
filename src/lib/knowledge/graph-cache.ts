/**
 * In-process TTL/LRU cache for Knowledge Graph API responses.
 *
 * The graph computation fans out over the entity graph and is expensive on the
 * first call, but the underlying data only changes when a document is indexed
 * or an entity is created/deleted/merged. So a short TTL (default 30s) makes
 * repeated opens instant while bounded staleness; explicit invalidation on
 * data mutation keeps it correct.
 *
 * Map insertion order doubles as recency order for the LRU eviction at
 * MAX_ENTRIES — re-reading a hit re-inserts it to keep it fresh.
 */

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

export interface GraphCacheParams {
  entityName: string;
  depth: number;
  maxNodes: number;
  mode: string;
  minDegree: number;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 64;

const CACHE = new Map<string, CacheEntry>();

function buildKey(userId: string, params: GraphCacheParams): string {
  // Sorted, stable key — order independence matches how the route normalizes.
  const { entityName, depth, maxNodes, mode, minDegree } = params;
  return `${userId}|${entityName || ""}|${depth}|${maxNodes}|${mode}|${minDegree}`;
}

/** Return cached graph data if present and unexpired, else undefined. */
export function getCachedGraph(userId: string, params: GraphCacheParams): unknown | undefined {
  const key = buildKey(userId, params);
  const entry = CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return undefined;
  }
  // Refresh recency (Map preserves insertion order; delete+set moves to end).
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry.data;
}

/** Store graph data, evicting the oldest entry if at capacity. */
export function setCachedGraph(
  userId: string,
  params: GraphCacheParams,
  data: unknown,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  const key = buildKey(userId, params);
  // Enforce capacity before insert so the new entry is never the immediate
  // eviction victim (the canonical LRU invariant).
  while (CACHE.size >= MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
  CACHE.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Drop all cached entries for a user (after indexing or entity mutations). */
export function invalidateUserGraph(userId: string): void {
  const prefix = `${userId}|`;
  for (const key of CACHE.keys()) {
    if (key.startsWith(prefix)) CACHE.delete(key);
  }
}

/** Clear everything — primarily for tests. */
export function clearGraphCache(): void {
  CACHE.clear();
}
