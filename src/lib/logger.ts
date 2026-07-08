/**
 * Centralised logger with redaction support.
 *
 * Replaces scattered `console.log/warn/error` calls so that:
 * 1. Log level can be controlled via LOG_LEVEL env var.
 * 2. Sensitive data (API keys, tokens, long content) can be redacted.
 * 3. Future migration to a structured logger is a single-file change.
 *
 * Design: §4.8 — config and logger centralisation.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = (() => {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  return "info";
})();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[CURRENT_LEVEL];
}

/**
 * Redact sensitive values from log metadata.
 *
 * - Strings matching API key patterns (Bearer xxx, sk-xxx, long hex) → "[REDACTED]"
 * - Strings longer than 500 chars → truncated to 200 chars + "[...truncated]"
 */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    // Redact API keys and bearer tokens
    if (/^(Bearer\s+|sk-|rk-|pk-)/i.test(value)) return "[REDACTED]";
    if (/^[a-f0-9]{32,}$/i.test(value)) return "[REDACTED]";
    // Truncate long content (e.g. generated text, prompts)
    if (value.length > 500) {
      return value.slice(0, 200) + "[...truncated]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Redact known sensitive keys regardless of value
      if (/key|token|secret|password|apikey/i.test(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redact(v);
      }
    }
    return result;
  }
  return value;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      console.debug(message, meta ? redact(meta) : "");
    }
  },
  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      console.log(message, meta ? redact(meta) : "");
    }
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      console.warn(message, meta ? redact(meta) : "");
    }
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      console.error(message, meta ? redact(meta) : "");
    }
  },
  /** Expose redact for callers that format their own messages. */
  redact,
};
