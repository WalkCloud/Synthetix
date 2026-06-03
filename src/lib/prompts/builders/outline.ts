import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildOutlinePrompt(locale: DocumentLanguage = "en"): string {
  return locale === "zh-CN" ? ZH_PROMPTS.outline : EN_PROMPTS.outline;
}
