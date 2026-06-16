import type { DocumentLanguage } from "@/lib/prompts";
import assessment from "./assessment";
import bidding from "./bidding";
import consulting from "./consulting";
import general from "./general";
import operations from "./operations";
import planning from "./planning";
import proposal from "./proposal";
import technicalSolution from "./technical-solution";

export type ArchetypeLocale = DocumentLanguage;

export interface LocalizedArchetypeText {
  en: string;
  "zh-CN": string;
}

export interface ArchetypeSkill {
  id: string;
  label: LocalizedArchetypeText;
  useWhen: LocalizedArchetypeText;
  principle: LocalizedArchetypeText;
  skeleton: LocalizedArchetypeText;
  focus: LocalizedArchetypeText;
}

export interface ArchetypeSkeleton {
  principle: string;
  skeleton: string;
  focus: string;
}

const skills = [
  technicalSolution,
  proposal,
  bidding,
  consulting,
  planning,
  assessment,
  operations,
  general,
] satisfies ArchetypeSkill[];

const registry = new Map(skills.map((skill) => [skill.id, skill]));

export const ARCHETYPE_IDS = skills.map((skill) => skill.id);

export function getAllArchetypes(): ArchetypeSkill[] {
  return [...skills];
}

export function getArchetype(id: string | null | undefined): ArchetypeSkill | undefined {
  if (!id) return undefined;
  return registry.get(id.trim());
}

export function isKnownArchetype(id: string | null | undefined): boolean {
  return Boolean(getArchetype(id));
}

export function normalizeArchetypeId(id: string | null | undefined): string | null {
  return getArchetype(id)?.id ?? null;
}

export function composeArchetypeKey(
  primaryId: string | null | undefined,
  secondaryId: string | null | undefined,
): string {
  const primary = normalizeArchetypeId(primaryId) ?? "general";
  const secondary = normalizeArchetypeId(secondaryId);

  if (!secondary || secondary === primary) {
    return primary;
  }

  return `${primary}+${secondary}`;
}

export function getArchetypeSkeleton(
  id: string,
  locale: ArchetypeLocale,
): ArchetypeSkeleton | undefined {
  const skill = getArchetype(id);
  if (!skill) return undefined;

  return {
    principle: skill.principle[locale],
    skeleton: skill.skeleton[locale],
    focus: skill.focus[locale],
  };
}

export function getArchetypeChoices(locale: ArchetypeLocale): string {
  return skills
    .map((skill) => `${skill.id} (${skill.label[locale]}): ${skill.useWhen[locale]}`)
    .join(", ");
}
