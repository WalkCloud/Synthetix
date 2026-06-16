function normalizeHeading(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+(\.\d+)*\.?\s*/, "")
    .replace(/[*_`~#：:，,。.\s]/g, "")
    .trim();
}

export function stripLeadingSectionTitle(
  content: string,
  sectionTitle?: string | null,
): string {
  if (!content.trim() || !sectionTitle?.trim()) return content;

  const normalizedTitle = normalizeHeading(sectionTitle);
  if (!normalizedTitle) return content;

  const lines = content.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return content;

  const firstLine = lines[firstContentIndex];
  if (normalizeHeading(firstLine) !== normalizedTitle) {
    return content;
  }

  lines.splice(firstContentIndex, 1);
  while (lines[firstContentIndex]?.trim() === "") {
    lines.splice(firstContentIndex, 1);
  }
  return lines.join("\n").trimStart();
}
