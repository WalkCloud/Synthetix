/**
 * Normalised parsing of LLM provider rate-limit response headers.
 *
 * Different providers emit subtly different header names for the same concept:
 *   OpenAI / Azure:    x-ratelimit-remaining-requests, x-ratelimit-remaining-tokens
 *                      x-ratelimit-reset-requests, x-ratelimit-reset-tokens
 *   Anthropic:         anthropic-ratelimit-requests-remaining, ...-tokens-remaining
 *                      anthropic-ratelimit-requests-reset, ...-tokens-reset
 *   Generic proxies:   x-ratelimit-remaining, x-ratelimit-reset, retry-after
 *                      (and occasionally x-ratelimit-limit-*)
 *
 * This collapses all of those into one normalised shape so the adaptive
 * limiter never has to know which provider it's talking to. Unknown/absent
 * fields are left `undefined` — callers treat undefined as "no signal".
 *
 * Pure module: no I/O, no side effects, fully deterministic → easy to test.
 */

export interface RateLimitInfo {
  /** Remaining requests in the current window (if reported). */
  remainingRequests?: number;
  /** Remaining tokens in the current window (if reported). */
  remainingTokens?: number;
  /** Total request limit in the window (if reported). */
  limitRequests?: number;
  /** Total token limit in the window (if reported). */
  limitTokens?: number;
  /** Ms until the request quota resets (if reported). */
  resetRequestsMs?: number;
  /** Ms until the token quota resets (if reported). */
  resetTokensMs?: number;
  /** Ms to wait before retrying (from Retry-After). */
  retryAfterMs?: number;
}

/** A header lookup that tolerates case + multiple naming conventions. */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const info: RateLimitInfo = {};

  // remaining-requests / remaining-tokens
  info.remainingRequests =
    firstNumber(headers, [
      "x-ratelimit-remaining-requests",
      "anthropic-ratelimit-requests-remaining",
      "x-ratelimit-remaining",
    ]) ?? undefined;
  info.remainingTokens =
    firstNumber(headers, [
      "x-ratelimit-remaining-tokens",
      "anthropic-ratelimit-tokens-remaining",
    ]) ?? undefined;

  // limit-* (the ceiling — lets us compute a budget directly when reported)
  info.limitRequests =
    firstNumber(headers, [
      "x-ratelimit-limit-requests",
      "anthropic-ratelimit-requests-limit",
      "x-ratelimit-limit",
    ]) ?? undefined;
  info.limitTokens =
    firstNumber(headers, [
      "x-ratelimit-limit-tokens",
      "anthropic-ratelimit-tokens-limit",
    ]) ?? undefined;

  // reset windows (seconds → ms). Anthropic emits "1m20s" / ISO durations;
  // OpenAI emits plain seconds ("1.2"). We parse both.
  info.resetRequestsMs =
    parseDuration(
      firstString(headers, [
        "x-ratelimit-reset-requests",
        "anthropic-ratelimit-requests-reset",
        "x-ratelimit-reset",
      ]),
    ) ?? undefined;
  info.resetTokensMs =
    parseDuration(
      firstString(headers, [
        "x-ratelimit-reset-tokens",
        "anthropic-ratelimit-tokens-reset",
      ]),
    ) ?? undefined;

  // Retry-After (seconds or HTTP-date). Reuses the retry-after parser for the
  // date form; seconds form is handled inline here for clarity.
  const retryAfter = firstString(headers, ["retry-after"]);
  if (retryAfter != null) {
    const ms = parseRetryAfterLike(retryAfter);
    if (ms !== null) info.retryAfterMs = ms;
  }

  // Drop the object entirely if nothing was found, so callers can do a cheap
  // truthiness check rather than inspecting every field.
  const hasAny = Object.values(info).some((v) => v !== undefined);
  return hasAny ? info : {};
}

/** Whether the response carries ANY rate-limit signal the limiter can use. */
export function hasRateLimitSignal(info: RateLimitInfo | undefined): boolean {
  if (!info) return false;
  return (
    info.remainingRequests !== undefined ||
    info.remainingTokens !== undefined ||
    info.limitRequests !== undefined ||
    info.limitTokens !== undefined ||
    info.retryAfterMs !== undefined
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function firstString(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const v = headers.get(name);
    if (v != null && v.trim() !== "") return v.trim();
  }
  return null;
}

function firstNumber(headers: Headers, names: string[]): number | null {
  const raw = firstString(headers, names);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse a duration header value into ms. Supports:
 *   - plain seconds: "1.2" → 1200
 *   - mm:ss / hh:mm:ss: "1m20s" handled, "20" (seconds) handled
 *   - Anthropic-style: "1m20s", "20s", "500ms", "1h"
 *   - HTTP-date (deferred to parseRetryAfterLike)
 */
function parseDuration(raw: string | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Plain number = seconds (OpenAI convention).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(parseFloat(trimmed) * 1000);
  }

  // Compound: 1h2m3s / 1m20s / 500ms / 20s
  const msMatch = /^(\d+(?:\.\d+)?)ms$/.exec(trimmed);
  if (msMatch) return Math.round(parseFloat(msMatch[1]));

  let totalMs = 0;
  let matched = false;
  // NOTE: no \b after the unit — "1h30m" has no word boundary between 'h' and
  // '3' (both are word chars), so \b would drop the '1h' term. The unit char
  // class itself delimits each term adequately.
  const unitRe = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)(?=\d|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = unitRe.exec(trimmed)) !== null) {
    matched = true;
    const val = parseFloat(m[1]);
    switch (m[2].toLowerCase()) {
      case "ms": totalMs += val; break;
      case "s":  totalMs += val * 1000; break;
      case "m":  totalMs += val * 60_000; break;
      case "h":  totalMs += val * 3_600_000; break;
      case "d":  totalMs += val * 86_400_000; break;
    }
  }
  if (matched) return Math.round(totalMs);

  return null;
}

/** Seconds or HTTP-date → ms. Mirrors retry-after.ts but kept local to avoid
 *  a cross-module dep cycle when this module is imported by the limiter. */
function parseRetryAfterLike(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(parseInt(trimmed, 10) * 1000, 5 * 60_000);
  }
  if (!/[a-z]/i.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.min(ms - Date.now(), 5 * 60_000));
}
