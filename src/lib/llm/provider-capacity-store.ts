/**
 * Per-provider capacity persistence (the limiter's long-term memory).
 *
 * The adaptive limiter probes a provider's true capacity by slow-start + AIMD.
 * That probing cost real requests (the "tuition"). This store persists what
 * was learned so a restart / sibling process starts from the known ceiling
 * instead of probing from scratch — the tuition is paid once per provider,
 * across the whole deployment lifetime.
 *
 * Storage: a single JSON file shared with the Python graph worker
 * (workers/python/rag_index.py reads the same path). This avoids giving Python
 * a DB dependency. The file is a cache of statistics — capacity is a slowly-
 * varying value, so the last-writer-wins concurrency between Node and Python
 * is acceptable: a stale read only causes a brief re-probe, never corruption.
 *
 * File location mirrors the wiki-progress / DB_PATH convention.
 */

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";

export interface ProviderCapacityRecord {
  /** Current operating budget (token-weighted). Start point after boot. */
  budgetTokens: number;
  /** Highest budget sustained without a 429 (the probed ceiling). */
  discoveredCeiling: number;
  /** Lowest budget we've been forced down to (informs floor calibration). */
  discoveredFloor: number;
  /** Whether this provider emits x-ratelimit-* / Retry-After headers. */
  emitsRateLimitHeaders: boolean;
  /** Epoch ms of the most recent 429 (for backoff + re-probe decisions). */
  last429At: number | null;
  /** Epoch ms this record was last written. */
  lastUpdated: number;
}

interface StoreShape {
  [providerKey: string]: ProviderCapacityRecord;
}

const CAPACITY_DIRNAME = "provider-capacity";
const CAPACITY_FILENAME = "provider-capacity.json";

function resolveCapacityDir(): string {
  const root = process.env.DB_PATH || path.join(os.homedir(), "synthetix-data");
  return path.join(root, CAPACITY_DIRNAME);
}

function resolveCapacityFile(): string {
  return path.join(resolveCapacityDir(), CAPACITY_FILENAME);
}

/**
 * In-process cache + write-through to disk. Reads are frequent (every acquire
 * on a cold limiter), writes are infrequent (only on ceiling change). The
 * cache is loaded lazily once per process; subsequent writes update both the
 * cache and the file.
 *
 * The Python graph worker (rag_index.py) writes to the SAME file with the SAME
 * key format (after the unification fix). To pick up Python's budget changes
 * (e.g. a 429-driven multiplicative-decrease), we check the file's mtime on
 * every read — if the file was modified by another process, we reload it.
 * This is cheap (a single stat) and ensures cross-process budget sharing
 * without polling overhead.
 */
let cache: StoreShape | null = null;
let cacheMtimeMs = 0;
let loadPromise: Promise<StoreShape> | null = null;

async function load(forceReload = false): Promise<StoreShape> {
  if (cache && !forceReload) {
    // Check if the file was modified by another process (Python graph worker).
    // A stat is ~microseconds and avoids stale budget reads across processes.
    const file = resolveCapacityFile();
    const stat = await fsp.stat(file).catch(() => null);
    if (stat && stat.mtimeMs === cacheMtimeMs) {
      return cache; // file unchanged — cache is fresh
    }
    // File changed externally → fall through to reload.
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const file = resolveCapacityFile();
    const stat = await fsp.stat(file).catch(() => null);
    if (cache && stat && stat.mtimeMs === cacheMtimeMs && !forceReload) {
      return cache;
    }
    try {
      const raw = await fsp.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as StoreShape;
      cache = parsed && typeof parsed === "object" ? parsed : {};
      // Migrate: remove legacy "graph:" prefixed keys (pre-unification Python
      // used a separate namespace). These are now dead records — the unified
      // key format is "openai_compatible:<normalized_url>" on both sides.
      let migrated = false;
      for (const key of Object.keys(cache)) {
        if (key.startsWith("graph:")) {
          delete cache[key];
          migrated = true;
        }
      }
      if (migrated) {
        // Persist the cleaned store so we don't re-process on every load.
        // (Deferred — we just update cache; the next persist() will write it.)
      }
    } catch {
      // Missing / corrupt file → empty store. Not an error: a fresh deploy
      // simply has no learned capacity yet, and the limiter probes from floor.
      cache = {};
    }
    cacheMtimeMs = stat?.mtimeMs ?? 0;
    return cache;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/** Synchronous read used by the Python-side mirror (and tests). Falls back to
 *  empty if the file isn't loaded yet — callers that need freshness should
 *  call the async variant. */
export function readCapacitySync(providerKey: string): ProviderCapacityRecord | null {
  // Best-effort: only returns cached data. Disk read is async-only here to
  // avoid blocking the event loop on a hot path; if nothing is cached yet,
  // callers fall back to defaults.
  if (!cache) return null;
  return cache[providerKey] ?? null;
}

export async function readCapacity(providerKey: string): Promise<ProviderCapacityRecord | null> {
  const store = await load();
  return store[providerKey] ?? null;
}

export async function writeCapacity(
  providerKey: string,
  record: ProviderCapacityRecord,
): Promise<void> {
  const store = await load();
  store[providerKey] = record;
  await persist();
}

/** Merge a partial update into the existing record, creating if absent. */
export async function updateCapacity(
  providerKey: string,
  patch: Partial<ProviderCapacityRecord>,
): Promise<ProviderCapacityRecord> {
  const store = await load();
  const prev = store[providerKey];
  const merged: ProviderCapacityRecord = {
    budgetTokens: prev?.budgetTokens ?? 0,
    discoveredCeiling: prev?.discoveredCeiling ?? 0,
    discoveredFloor: prev?.discoveredFloor ?? 0,
    emitsRateLimitHeaders: prev?.emitsRateLimitHeaders ?? false,
    last429At: prev?.last429At ?? null,
    lastUpdated: prev?.lastUpdated ?? Date.now(),
    ...patch,
  };
  // Always bump lastUpdated on a write, regardless of what patch carried.
  merged.lastUpdated = Date.now();
  store[providerKey] = merged;
  await persist();
  return merged;
}

/** Atomic-ish write: write to a temp file then rename (crash-safe on POSIX,
 *  best-effort on Windows). */
async function persist(): Promise<void> {
  if (!cache) return;
  const dir = resolveCapacityDir();
  const file = resolveCapacityFile();
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cache, null, 2), "utf-8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows rename can race; fall back to direct write.
    await fsp.writeFile(file, JSON.stringify(cache, null, 2), "utf-8");
  }
  // Update mtime so our own write doesn't trigger a spurious reload.
  const stat = await fsp.stat(file).catch(() => null);
  cacheMtimeMs = stat?.mtimeMs ?? 0;
}

/** Force a reload from disk on the next read, picking up changes written by
 *  the Python process. Called by the limiter's periodic sync. */
export async function reloadCapacityStore(): Promise<void> {
  await load(true);
}

/** Test helper: drop the in-process cache so the next read hits disk. */
export function _resetCapacityCacheForTests(): void {
  cache = null;
  cacheMtimeMs = 0;
  loadPromise = null;
}
