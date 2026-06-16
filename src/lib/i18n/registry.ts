import type { Locale } from "./constants";

export interface LocaleEntry {
  code: Locale;
  name: string;
  nativeName: string;
  enabled: boolean;
  /** If true, this locale is only shown in development mode */
  devOnly?: boolean;
}

/**
 * Release toggle: Set zh-CN.devOnly = false to enable in production.
 * During development, all locales are available.
 * In production, devOnly locales are hidden from the selector.
 */
export const LOCALE_REGISTRY: LocaleEntry[] = [
  { code: "en", name: "English", nativeName: "English", enabled: true },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文", enabled: true, devOnly: false },
];

export function getLocaleEntry(code: Locale): LocaleEntry | undefined {
  return LOCALE_REGISTRY.find((e) => e.code === code);
}

/**
 * Get locales available for the user to select.
 * In production, filters out devOnly locales.
 * In development (NODE_ENV=development), shows all enabled locales.
 */
export function getEnabledLocales(): LocaleEntry[] {
  const isDev = process.env.NODE_ENV === "development";
  return LOCALE_REGISTRY.filter((e) => {
    if (!e.enabled) return false;
    if (e.devOnly && !isDev) return false;
    return true;
  });
}
