/**
 * Shared HTTP and token-estimation primitives for LLM adapters.
 *
 * Unified from llm/adapter.ts, llm/anthropic-adapter.ts, and
 * llm/provider-probe.ts (design §4.6). Each call site had identical
 * `fetchWithTimeout` and `estimateTokens` implementations.
 */

/**
 * Fetch with an AbortController-based timeout.
 *
 * The caller MUST pass the appropriate timeoutMs — production adapters use
 * FETCH_TIMEOUT_MS / EMBED_FETCH_TIMEOUT_MS, while the provider probe uses its
 * own shorter timeout. This function does not pick a default so callers stay
 * explicit about which budget applies.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

/**
 * Rough token estimate: ~1.5 chars per token.
 *
 * This is a fast heuristic used for batching and context-window budgeting,
 * not for billing. All three former implementations used the same formula.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.5));
}
