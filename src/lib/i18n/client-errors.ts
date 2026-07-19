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
 * 2. Use the caller-provided localized domain fallback when supplied.
 * 3. Fall back to errorMap.unknown. Server-provided prose is never exposed.
 */
export function getLocalizedError(
  data: { code?: string; error?: unknown; message?: unknown } | undefined | null,
  errorMap?: TranslationSchema["errors"],
  fallback?: string,
): string {
  const map = errorMap ?? getErrorMap();

  if (data?.code && data.code in map) {
    return map[data.code as keyof typeof map];
  }

  return fallback ?? map.unknown;
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
