/**
 * Small env-var helpers shared by the LLM adapters.
 *
 * Centralised so {@link OpenAICompatibleAdapter} and {@link AnthropicAdapter}
 * read the same knobs and stay in sync. All fallbacks preserve the historical
 * hardcoded behaviour — setting an env var only overrides, it never disables
 * a safety bound.
 */

/**
 * Read a positive integer from the environment. Returns `fallback` when the
 * variable is unset or holds a non-positive / non-numeric value.
 */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Overall fetch ceiling for non-streaming `chat()` / `embed()` calls. Covers
 * the connect + full-response wait. A hung provider can otherwise block a
 * pipeline worker for up to `3 × this` (3 retries) before surfacing.
 */
export const FETCH_TIMEOUT_MS = readPositiveIntEnv("LLM_FETCH_TIMEOUT_MS", 300_000);

/**
 * Fetch ceiling for embedding batches. Embedding calls are short and bounded
 * (no streaming); a 5-min timeout let one hung batch block the pipeline for
 * ~15 min across retries. 90s is ample for a large batch while failing fast.
 */
export const EMBED_FETCH_TIMEOUT_MS = readPositiveIntEnv("LLM_EMBED_TIMEOUT_MS", 90_000);

/**
 * Per-`reader.read()` timeout for streamed chat responses. Fires when the
 * provider holds the connection open without emitting bytes (a documented
 * failure mode — see adaptive-limiter.ts). Long enough for a slow-but-progressing
 * stream, short enough to surface a genuine stall.
 */
export const STREAM_READ_TIMEOUT_MS = readPositiveIntEnv("LLM_STREAM_READ_TIMEOUT_MS", 120_000);
