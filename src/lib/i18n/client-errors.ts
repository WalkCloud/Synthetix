import type { TranslationSchema } from "./types";
import type { ErrorCode } from "@/lib/api-helpers";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

const LOCALE_MAP: Record<string, TranslationSchema["errors"]> = {
  en: en.errors,
  "zh-CN": zhCN.errors,
};

/**
 * Read the current locale from cookie (set by LocaleProvider).
 * Falls back to "en" if not found.
 */
function readLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en";
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("synthetix-locale="));
  return match ? decodeURIComponent(match.split("=")[1]) : "en";
}

/**
 * Get the error translation map for the current locale.
 * Works outside React context — suitable for hooks and utilities.
 */
export function getErrorMap(): TranslationSchema["errors"] {
  const locale = readLocaleFromCookie();
  return LOCALE_MAP[locale] ?? LOCALE_MAP.en;
}

/**
 * Map an API error response to a localized user-facing message.
 *
 * Usage (inside React component with useLocale):
 *   const { t } = useLocale();
 *   toast.error(getLocalizedError(data, t.errors));
 *
 * Usage (inside hooks, no React context):
 *   toast.error(getLocalizedError(data));
 *
 * Resolution order:
 * 1. If `data.code` exists and matches a key in errorMap, use the localized string.
 * 2. If `data.error` is a string, return it as-is (server-side English fallback).
 * 3. Fall back to errorMap.unknown.
 */
export function getLocalizedError(
  data: { code?: string; error?: string; message?: string } | undefined | null,
  errorMap?: TranslationSchema["errors"],
): string {
  const map = errorMap ?? getErrorMap();

  if (!data) return map.unknown;

  // 1. Try code-based lookup
  if (data.code && data.code in map) {
    return map[data.code as keyof typeof map];
  }

  // 2. Fallback to server message
  const msg = data.error || data.message;
  if (typeof msg === "string" && msg.length > 0) {
    return msg;
  }

  // 3. Final fallback
  return map.unknown;
}

/**
 * Quick helper: return the error code string if present, else null.
 * Useful when the caller wants to branch on specific error types.
 */
export function getErrorCode(
  data: { code?: string } | undefined | null,
): ErrorCode | null {
  if (data?.code) return data.code as ErrorCode;
  return null;
}
