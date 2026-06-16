const MARKERS = [
  "NEEDS_GATHERED",
  "DIRECTION_CONFIRMED",
  "GENERATE_DIRECT",
  "SECTION_BY_SECTION",
  "ALL_SECTIONS_CONFIRMED",
] as const;

export type Marker = (typeof MARKERS)[number];

export function detectMarker(content: string): Marker | null {
  // Terminal action markers (generate the outline) must win over earlier
  // transitional ones. The assistant occasionally emits a stray NEEDS_GATHERED
  // or DIRECTION_CONFIRMED earlier in its reply AND a GENERATE_DIRECT at the
  // end; iterating MARKERS in declaration order would return the transitional
  // marker and never trigger outline generation. Check the terminal markers
  // first so the generate intent is honored.
  const TERMINAL: Marker[] = ["GENERATE_DIRECT", "ALL_SECTIONS_CONFIRMED"];
  for (const marker of TERMINAL) {
    if (content.includes(marker)) return marker;
  }
  for (const marker of MARKERS) {
    if (content.includes(marker)) return marker;
  }
  return null;
}

export function stripMarker(content: string, marker: Marker | null): string {
  if (!marker) return content;
  return content.replace(marker, "").trimEnd();
}
