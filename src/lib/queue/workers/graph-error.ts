/**
 * Graph extraction failure classification + retry policy.
 *
 * Graph extraction is the pipeline's most fragile stage: it issues many
 * per-chunk LLM calls (force_serial, 2-concurrent) over a long window, so
 * transient provider failures (rate limits, brief 5xx, network blips) are
 * common and SHOULD be retried rather than surfacing as a hard document
 * failure. Configuration/auth problems, by contrast, will fail every retry
 * identically and should short-circuit to a soft-land with a clear warning.
 *
 * Keep this binary (retryable vs not) — it covers ~95% of real failures and
 * stays easy to test. Four-way taxonomies look thorough on paper but the
 * action set is always just "retry or give up".
 */

/** Semantic bucket for a graph failure, surfaced in task resultData. */
export type GraphErrorType =
  | "rate_limit"
  | "timeout"
  | "network"
  | "server_error"
  | "auth"
  | "config"
  | "data"
  | "unknown";

export interface ClassifiedGraphError {
  /** Whether another attempt has a reasonable chance of succeeding. */
  retryable: boolean;
  /** Stable label written to rag_index.resultData for UI/diagnostics. */
  type: GraphErrorType;
}

/** Substrings (case-insensitive, matched anywhere) → error type + retryable. */
const PATTERNS: Array<{ test: string[]; type: GraphErrorType; retryable: boolean }> = [
  // Transient — retry. Order matters: check 429 before generic 5xx/auth.
  { test: ["429", "rate limit", "rate_limit", "too many requests", "quota"], type: "rate_limit", retryable: true },
  { test: ["timeout", "timed out", "deadline exceeded", "<timeout after"], type: "timeout", retryable: true },
  { test: ["econnreset", "etimedout", "enotfound", "eai_again", "econnrefused", "socket hang up", "network", "connection aborted", "connection reset"], type: "network", retryable: true },
  { test: ["500", "502", "503", "504", "bad gateway", "service unavailable", "gateway timeout", "internal server error", "overloaded"], type: "server_error", retryable: true },
  // Persistent — don't retry.
  { test: ["401", "unauthorized", "not authenticated"], type: "auth", retryable: false },
  { test: ["403", "forbidden", "permission denied"], type: "auth", retryable: false },
  { test: ["404", "model not found", "model_not_found", "no such model"], type: "config", retryable: false },
  { test: ["invalid api_base", "invalid_api_base", "invalid api key", "api key", "missing api"], type: "config", retryable: false },
  { test: ["embedding dimension", "embedding_dim", "dim mismatch", "dimension mismatch"], type: "data", retryable: false },
];

export function classifyGraphError(error: unknown): ClassifiedGraphError {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();

  for (const { test, type, retryable } of PATTERNS) {
    if (test.some((t) => message.includes(t))) {
      return { retryable, type };
    }
  }
  return { retryable: false, type: "unknown" };
}

/** Max retry attempts for a retryable graph failure (excluding the first try). */
export const GRAPH_MAX_RETRIES = (() => {
  const n = Number.parseInt(process.env.LIGHTRAG_GRAPH_MAX_RETRIES ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
})();

/** Per-attempt backoff in ms. Index 0 = before attempt #2, etc. Falls back to the last value. */
export const GRAPH_RETRY_BACKOFF_MS: number[] = (() => {
  const raw = process.env.LIGHTRAG_GRAPH_RETRY_BACKOFF_MS;
  if (raw) {
    const parsed = raw.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length > 0) return parsed;
  }
  return [120_000, 600_000]; // 2min, 10min
})();

export function graphRetryDelay(attempt: number): number {
  // attempt is 0-indexed (0 = delay before the 2nd try).
  return GRAPH_RETRY_BACKOFF_MS[Math.min(attempt, GRAPH_RETRY_BACKOFF_MS.length - 1)] ?? GRAPH_RETRY_BACKOFF_MS.at(-1) ?? 120_000;
}

/** User-facing warning appended to document.conversionWarning on graph soft-land.
 *  English-only to match the existing graphDowngradeWarning() convention —
 *  conversionWarning is a backend-generated DB field, not an i18n key. */
export function graphFailureWarning(type: GraphErrorType, retryable: boolean): string {
  const base = retryable
    ? "Knowledge graph extraction failed due to a transient service issue (rate limit/timeout). Basic search remains available; you can retry later."
    : type === "auth" || type === "config"
      ? "Knowledge graph extraction failed (LLM configuration or authentication issue). Basic search remains available; please check your model/API configuration and retry."
      : "Knowledge graph extraction failed. Basic search remains available; you can retry later.";
  return base;
}
