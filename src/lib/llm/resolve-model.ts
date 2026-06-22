import { db } from "@/lib/db";
import { parseCapabilities } from "./capabilities";

type ModelWithProvider = NonNullable<
  Awaited<ReturnType<typeof db.modelConfig.findFirst<{ include: { provider: true } }>>>
>;

function defaultSlotForCapability(capability: string): "llm" | "embedding" | "image" | "rerank" {
  if (capability === "embedding" || capability === "embed") return "embedding";
  if (capability === "image_generation" || capability === "image") return "image";
  if (capability === "rerank") return "rerank";
  return "llm";
}

function matchesCapability(rawCapabilities: unknown, capability: string): boolean {
  const caps = parseCapabilities(rawCapabilities);
  return (
    caps.includes(capability) ||
    (capability === "writing" && caps.includes("chat")) ||
    (capability === "chat" && caps.includes("writing"))
  );
}

// ── Short-TTL in-process cache ──────────────────────────────────────────────
// resolveModel runs up to 3 sequential findFirst/findMany per call, and
// createRagContext calls it 3x (embedding/writing/rerank) on every semantic
// search — so a single search was doing up to 9 DB round-trips just to resolve
// models that change only when the user edits Model Management settings.
//
// Cache key is `userId|capability`; TTL is short (60s) so cache IS NOT a
// correctness risk: a settings change is reflected within a minute, and the
// cache is also invalidated explicitly whenever model configs are written
// (see invalidateResolveModelCache).
const MODEL_CACHE_TTL_MS = 60_000;
const MODEL_CACHE_MAX = 128;
const modelCache = new Map<string, { value: ModelWithProvider | null; expiresAt: number }>();

function cacheKey(userId: string | undefined, capability: string): string {
  return `${userId ?? "*"}|${capability}`;
}

function readCache(key: string): ModelWithProvider | null | undefined {
  const hit = modelCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    modelCache.delete(key);
    return undefined;
  }
  // Refresh LRU recency by re-inserting (Map preserves insertion order, so
  // deleting + re-setting moves the entry to the end = most-recent).
  modelCache.delete(key);
  modelCache.set(key, hit);
  return hit.value;
}

function writeCache(key: string, value: ModelWithProvider | null): void {
  if (modelCache.size >= MODEL_CACHE_MAX && !modelCache.has(key)) {
    // Evict the oldest entry (first in insertion order = least recently used).
    const oldestKey = modelCache.keys().next().value;
    if (oldestKey) modelCache.delete(oldestKey);
  }
  modelCache.set(key, { value, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
}

/** Drop cached model resolutions. Call after any ModelConfig mutation. */
export function invalidateResolveModelCache(userId?: string): void {
  if (userId === undefined) {
    modelCache.clear();
    return;
  }
  const prefix = `${userId}|`;
  for (const key of modelCache.keys()) {
    if (key.startsWith(prefix)) modelCache.delete(key);
  }
}

export async function resolveModel(capability: string, userId?: string): Promise<ModelWithProvider | null> {
  const key = cacheKey(userId, capability);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const defaultFor = defaultSlotForCapability(capability);
  const userFilter = userId ? { provider: { userId } } : {};

  const scopedDefault = await db.modelConfig.findFirst({
    where: { isDefaultFor: defaultFor, ...userFilter },
    include: { provider: true },
  });

  let resolved: ModelWithProvider | null = null;

  if (scopedDefault && matchesCapability(scopedDefault.capabilities, capability)) {
    resolved = scopedDefault;
  } else {
    const legacyDefault = await db.modelConfig.findFirst({
      where: { isDefaultFor: "default", ...userFilter },
      include: { provider: true },
    });

    if (legacyDefault && matchesCapability(legacyDefault.capabilities, capability)) {
      resolved = legacyDefault;
    } else {
      const all = await db.modelConfig.findMany({
        where: userFilter,
        include: { provider: true },
      });
      resolved = all.find((m) => matchesCapability(m.capabilities, capability)) || null;
    }
  }

  writeCache(key, resolved);
  return resolved;
}
