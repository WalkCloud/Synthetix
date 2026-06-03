import type { DocumentLanguage } from "../index";
import { EN_PROMPTS } from "../locales/en-prompts";
import { ZH_PROMPTS } from "../locales/zh-CN-prompts";

export function buildFacilitatorPrompt(locale: DocumentLanguage = "en"): string {
  return locale === "zh-CN" ? ZH_PROMPTS.facilitator : EN_PROMPTS.facilitator;
}
