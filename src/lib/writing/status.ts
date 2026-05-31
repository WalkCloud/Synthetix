export type DraftStatus = "drafting" | "completed";

export type SectionStatus =
  | "pending"
  | "retrieving"
  | "generating"
  | "comparing"
  | "reviewing"
  | "summarized"
  | "locked"
  | "failed";

export const CONFIRMED_SECTION_STATUSES: SectionStatus[] = [
  "locked",
  "summarized",
];

export function isSectionDone(status: string): boolean {
  return CONFIRMED_SECTION_STATUSES.includes(status as SectionStatus);
}

export function deriveDraftStatus(sections: { status: string }[]): DraftStatus {
  const total = sections.length;
  if (total === 0) return "drafting";
  const done = sections.filter((s) => isSectionDone(s.status)).length;
  return done >= total ? "completed" : "drafting";
}
