import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildWritingContext(locale: DocumentLanguage = "en"): string {
  return locale === "zh-CN" ? ZH_PROMPTS.writingSystem : EN_PROMPTS.writingSystem;
}
