import type { DocumentLanguage } from "../index";
import { buildLightweightOutlinePrompt } from "@/lib/brainstorm/outline-prompt";

export function buildOutlinePrompt(locale: DocumentLanguage = "en"): string {
  return buildLightweightOutlinePrompt("general", locale);
}

export function buildLightweightOutlinePromptWrapper(
  archetype: string,
  locale: DocumentLanguage = "en",
): string {
  return buildLightweightOutlinePrompt(archetype, locale);
}
