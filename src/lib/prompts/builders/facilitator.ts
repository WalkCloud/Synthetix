import type { DocumentLanguage } from "../index";
import { composePromptSkills, type PromptSkillId } from "../skills";

export type BrainstormPromptPhase = "gathering" | "direction" | "mode_select" | "section_refine" | "ready_to_generate" | "ready";

const PHASE_SKILLS: Record<BrainstormPromptPhase, PromptSkillId[]> = {
  gathering: ["brainstorm-base", "brainstorm-discovery"],
  direction: ["brainstorm-base", "brainstorm-direction"],
  mode_select: ["brainstorm-base", "brainstorm-mode-select"],
  section_refine: ["brainstorm-base", "brainstorm-section-refine"],
  ready_to_generate: ["brainstorm-base", "brainstorm-mode-select"],
  ready: ["brainstorm-base", "brainstorm-mode-select"],
};

export function buildFacilitatorPrompt(
  locale: DocumentLanguage = "en",
  phase: BrainstormPromptPhase = "gathering",
): string {
  return composePromptSkills(locale, PHASE_SKILLS[phase] ?? PHASE_SKILLS.gathering);
}
