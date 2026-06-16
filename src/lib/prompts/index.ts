import type { Locale } from "@/lib/i18n/constants";
import { EN_PROMPTS, type PromptKey } from "./locales/en-prompts";
import { ZH_PROMPTS } from "./locales/zh-CN-prompts";

/**
 * Document language for prompt building.
 * Independent of UI language — a Chinese UI can generate English documents.
 */
export type DocumentLanguage = "en" | "zh-CN";

export function resolveDocumentLanguage(uiLocale: Locale, override?: string): DocumentLanguage {
  if (override === "zh-CN" || override === "zh") return "zh-CN";
  if (override === "en" || override === "en-US") return "en";
  return uiLocale === "zh-CN" ? "zh-CN" : "en";
}

/**
 * Get a localized prompt by key.
 * Falls back to English if the requested locale is not available.
 */
export function getPrompt<TKey extends PromptKey>(
  key: TKey,
  locale: DocumentLanguage = "en",
): string {
  if (locale === "zh-CN" && ZH_PROMPTS[key]) {
    return ZH_PROMPTS[key];
  }
  return EN_PROMPTS[key];
}

/**
 * Re-export individual prompt builders that accept locale.
 */
export { buildWritingContext } from "./builders/writing-context";
export { buildAuditPrompts } from "./builders/audit";
export { buildHumanizerPrompts } from "./builders/humanizer";
export { buildDiagramPrompts } from "./builders/diagram";
export { buildFacilitatorPrompt } from "./builders/facilitator";
export { buildOutlinePrompt } from "./builders/outline";
