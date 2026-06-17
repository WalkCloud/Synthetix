import type { OutlineSection } from "@/lib/outline-tree";

export interface GeneratedOutline {
  title: string;
  documentType?: string;
  sections: OutlineSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items.map((item) => item.trim()) : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getRawChildren(raw: Record<string, unknown>): unknown[] | undefined {
  const candidates = [raw.children, raw.subsections, raw.subSections, raw.items, raw.chapters];
  const found = candidates.find(Array.isArray);
  return Array.isArray(found) ? found : undefined;
}

function normalizeSection(raw: unknown): OutlineSection | null {
  if (!isRecord(raw)) return null;
  const title = asString(raw.title);
  if (!title) return null;

  const rawChildren = getRawChildren(raw);
  const children = rawChildren
    ? rawChildren.map(normalizeSection).filter((section): section is OutlineSection => section !== null)
    : undefined;

  return {
    num: asString(raw.num),
    title,
    description: asString(raw.description) || undefined,
    keyPoints: asStringArray(raw.keyPoints),
    estimatedWords: asNumber(raw.estimatedWords),
    writingRequirements: asString(raw.writingRequirements) || undefined,
    retrievalQuery: asString(raw.retrievalQuery) || undefined,
    referenceHints: asStringArray(raw.referenceHints),
    children: children && children.length > 0 ? children : undefined,
  };
}

function hasNestedSections(sections: OutlineSection[]): boolean {
  return sections.some((section) => Boolean(section.children?.length) || hasNestedSections(section.children ?? []));
}

function hasDottedTopLevelNumber(sections: OutlineSection[]): boolean {
  return sections.some((section) => /^\d+(?:\.\d+)+$/.test(section.num));
}

function buildHierarchyFromDottedNumbers(sections: OutlineSection[]): OutlineSection[] {
  const byNum = new Map<string, OutlineSection>();

  for (const section of sections) {
    const node: OutlineSection = { ...section, children: undefined };
    byNum.set(node.num, node);
  }

  for (const section of sections) {
    const node = byNum.get(section.num);
    if (!node || !section.children?.length) continue;

    node.children = [...(node.children ?? []), ...section.children];
  }

  const childNums = new Set<string>();
  const roots: OutlineSection[] = [];

  for (const section of sections) {
    const node = byNum.get(section.num);
    if (!node) continue;
    const parentNum = node.num.includes(".") ? node.num.split(".").slice(0, -1).join(".") : "";
    const parent = parentNum ? byNum.get(parentNum) : undefined;
    if (parent) {
      parent.children = [...(parent.children ?? []), node];
      childNums.add(node.num);
    } else {
      roots.push(node);
    }
  }

  return roots.filter((section) => !childNums.has(section.num));
}

export function renumberOutlineSections(sections: OutlineSection[], prefix = ""): OutlineSection[] {
  return sections.map((section, index) => {
    const num = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    const children = section.children?.length ? renumberOutlineSections(section.children, num) : undefined;
    return { ...section, num, children };
  });
}

// Default per-depth word estimates when the LLM omits estimatedWords.
const DEFAULT_EW_BY_DEPTH = [2000, 800, 500, 300, 200];

/**
 * Recursively fill any missing estimatedWords by distributing the parent's
 * estimate among its children (top-down), or falling back to a depth-based
 * default. The LLM (doubao) often omits estimatedWords on deeply nested
 * children; without this, draft sections get null → editor shows "No word
 * estimate".
 */
export function fillMissingEstimatedWords(
  sections: OutlineSection[],
  parentEW: number | undefined,
  depth: number,
): void {
  for (const s of sections) {
    if (!s.estimatedWords || s.estimatedWords <= 0) {
      s.estimatedWords = parentEW
        ? Math.max(200, Math.round(parentEW / sections.length))
        : (DEFAULT_EW_BY_DEPTH[depth] ?? 300);
    }
  }
  for (const s of sections) {
    if (s.children?.length) {
      fillMissingEstimatedWords(s.children, s.estimatedWords, depth + 1);
    }
  }
}

export function normalizeGeneratedOutline(raw: unknown): GeneratedOutline {
  if (!isRecord(raw)) throw new Error("Outline must be a JSON object");

  const title = asString(raw.title);
  if (!title) throw new Error("Outline title is required");
  if (!Array.isArray(raw.sections)) throw new Error("Outline sections must be an array");

  const parsedSections = raw.sections
    .map(normalizeSection)
    .filter((section): section is OutlineSection => section !== null);
  if (parsedSections.length === 0) throw new Error("Outline must contain at least one section");

  const hierarchicalSections = !hasNestedSections(parsedSections) && hasDottedTopLevelNumber(parsedSections)
    ? buildHierarchyFromDottedNumbers(parsedSections)
    : parsedSections;

  const finalSections = renumberOutlineSections(hierarchicalSections);
  fillMissingEstimatedWords(finalSections, undefined, 0);

  return {
    title,
    documentType: asString(raw.documentType) || undefined,
    sections: finalSections,
  };
}
