const MARKERS = [
  "NEEDS_GATHERED",
  "DIRECTION_CONFIRMED",
  "GENERATE_DIRECT",
  "SECTION_BY_SECTION",
  "ALL_SECTIONS_CONFIRMED",
] as const;

export type Marker = (typeof MARKERS)[number];

export function detectMarker(content: string): Marker | null {
  for (const marker of MARKERS) {
    if (content.includes(marker)) return marker;
  }
  return null;
}

export function stripMarker(content: string, marker: Marker | null): string {
  if (!marker) return content;
  return content.replace(marker, "").trimEnd();
}
