interface OutlineNode {
  num: string;
  title: string;
  children?: OutlineNode[];
}

export function normalizeTitle(title: string): string {
  return title.replace(/^\d+(\.\d+)*\.?\s*/, "").trim();
}

export function flattenOutlineNumbers(
  nodes: OutlineNode[] | undefined,
  result = new Map<string, string>(),
): Map<string, string> {
  if (!nodes) return result;
  for (const node of nodes) {
    const key = normalizeTitle(node.title);
    if (key && node.num) {
      result.set(key, node.num);
    }
    flattenOutlineNumbers(node.children, result);
  }
  return result;
}

export function parseOutlineNumbers(outline?: string | null): Map<string, string> {
  if (!outline) return new Map();
  try {
    const parsed = JSON.parse(outline) as { sections?: OutlineNode[] };
    return flattenOutlineNumbers(parsed.sections);
  } catch {
    return new Map();
  }
}

export function getOutlineNumber(
  section: { title: string; index: number; constraints?: string | null },
  draftOutline?: string | null,
  explicitFallback?: string,
): string {
  const fallback = explicitFallback
    ?? parseOutlineNumbers(draftOutline).get(normalizeTitle(section.title))
    ?? String(section.index + 1);
  if (!section.constraints) return fallback;
  try {
    const parsed = JSON.parse(section.constraints) as { outlineNumber?: unknown };
    return typeof parsed.outlineNumber === "string" && parsed.outlineNumber.trim()
      ? parsed.outlineNumber
      : fallback;
  } catch {
    return fallback;
  }
}
