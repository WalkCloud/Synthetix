export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
}

interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  lockMs?: number;
  clock?: () => number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  recordFailure(key: string): RateLimitResult;
  clear(key: string): void;
}

const stores = new Set<Map<string, RateLimitEntry>>();

export function createRateLimiter({
  limit,
  windowMs,
  lockMs = windowMs,
  clock = Date.now,
}: RateLimiterOptions): RateLimiter {
  const entries = new Map<string, RateLimitEntry>();
  stores.add(entries);

  function currentEntry(key: string, now: number): RateLimitEntry | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now >= entry.lockedUntil && now - entry.windowStartedAt >= windowMs) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  function resultFor(entry: RateLimitEntry | undefined, now: number): RateLimitResult {
    if (!entry || now >= entry.lockedUntil) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1_000)),
    };
  }

  return {
    check(key) {
      const now = clock();
      return resultFor(currentEntry(key, now), now);
    },

    recordFailure(key) {
      const now = clock();
      const entry = currentEntry(key, now) ?? {
        failures: 0,
        windowStartedAt: now,
        lockedUntil: 0,
      };
      entry.failures += 1;
      if (entry.failures >= limit) {
        entry.lockedUntil = now + lockMs;
      }
      entries.set(key, entry);
      return resultFor(entry, now);
    },

    clear(key) {
      entries.delete(key);
    },
  };
}

export function resetRateLimitsForTest(): void {
  for (const store of stores) store.clear();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase("en-US");
}

function trustedProxyHops(): number {
  const configured = process.env.TRUST_PROXY_HOPS?.trim().toLowerCase();
  if (!configured) return 0;
  if (configured === "true") return 1;
  const hops = Number.parseInt(configured, 10);
  return Number.isFinite(hops) && hops > 0 ? hops : 0;
}

export function getClientIp(request: Request): string {
  const hops = trustedProxyHops();
  if (hops === 0) return "direct";

  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "direct";

  const addresses = forwarded
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length === 0) return "direct";

  const index = Math.max(0, addresses.length - hops - 1);
  return addresses[index] ?? "direct";
}

export const loginAccountRateLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1_000,
  lockMs: 15 * 60 * 1_000,
});

export const loginIpRateLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 1_000,
  lockMs: 60 * 1_000,
});

export const setupIpRateLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1_000,
  lockMs: 15 * 60 * 1_000,
});
