import type { OutlineData } from "@/types/writing";
import { db } from "@/lib/db";

export interface OutlineSectionLike {
  num?: string;
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
  children?: OutlineSectionLike[];
}

export function isValidOutline(outline: unknown): outline is OutlineData {
  if (typeof outline !== "object" || outline === null) return false;
  const obj = outline as Record<string, unknown>;
  if (typeof obj.title !== "string" || obj.title.trim().length === 0) return false;
  if (!Array.isArray(obj.sections)) return false;
  return obj.sections.every(
    (section: unknown) =>
      typeof section === "object" &&
      section !== null &&
      typeof (section as Record<string, unknown>).num === "string" &&
      typeof (section as Record<string, unknown>).title === "string"
  );
}

type OutlineResult =
  | { outline: OutlineData; resolvedSessionId: string | null }
  | { error: string; status: number };

export async function resolveOutline(
  sessionId: string | undefined,
  directOutline: OutlineData | undefined,
  userId: string
): Promise<OutlineResult> {
  if (directOutline) {
    if (!isValidOutline(directOutline)) return { error: "Invalid outline structure", status: 400 };
    return { outline: directOutline, resolvedSessionId: sessionId ?? null };
  }

  if (!sessionId) return { error: "Either sessionId or outline must be provided", status: 400 };

  const session = await db.brainstormSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return { error: "Brainstorm session not found", status: 404 };
  if (!session.outline) return { error: "Session does not have a generated outline", status: 400 };

  try {
    const parsed = JSON.parse(session.outline) as unknown;
    if (!isValidOutline(parsed)) return { error: "Session outline is invalid", status: 400 };
    return { outline: parsed, resolvedSessionId: sessionId };
  } catch {
    return { error: "Session outline is not valid JSON", status: 400 };
  }
}

interface FlatSectionInput {
  parentId: string | null;
  index: number;
  title: string;
  description: string | null;
  keyPoints: string | null;
  estimatedWords: number | null;
  constraints: string | null;
  depth: number;
  path: number[];
}

function buildHiddenConstraints(section: OutlineSectionLike): string | null {
  const constraints: Record<string, unknown> = {};
  if (section.num) constraints.outlineNumber = section.num;
  if (section.writingRequirements) constraints.writingRequirements = section.writingRequirements;
  if (section.retrievalQuery) constraints.retrievalQuery = section.retrievalQuery;
  if (section.referenceHints && section.referenceHints.length > 0) constraints.referenceHints = section.referenceHints;
  return Object.keys(constraints).length > 0 ? JSON.stringify(constraints) : null;
}

function flattenRecursive(sections: OutlineSectionLike[], parentPath: number[], depth: number): FlatSectionInput[] {
  const result: FlatSectionInput[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const currentPath = [...parentPath, i];
    result.push({
      parentId: null, index: i, title: section.title,
      description: section.description ?? null,
      keyPoints: section.keyPoints ? JSON.stringify(section.keyPoints) : null,
      estimatedWords: section.estimatedWords ?? null,
      constraints: buildHiddenConstraints(section),
      depth, path: currentPath,
    });
    if (section.children && section.children.length > 0) {
      result.push(...flattenRecursive(section.children, currentPath, depth + 1));
    }
  }
  return result;
}

export function flattenOutlineSections(outline: OutlineData): FlatSectionInput[] {
  return flattenRecursive(outline.sections, [], 0);
}

export async function createDraftWithSections(userId: string, outline: OutlineData, sessionId: string | null) {
  const draft = await db.draft.create({
    data: { userId, title: outline.title, outline: JSON.stringify(outline), status: "drafting", sessionId },
  });

  const flatSections = flattenOutlineSections(outline);
  const idMap = new Map<string, string>();
  let globalIndex = 0;

  for (const section of flatSections) {
    const parentPathKey = section.path.slice(0, -1).join(",");
    const parentId = section.depth > 0 ? (idMap.get(parentPathKey) ?? null) : null;
    const created = await db.section.create({
      data: {
        draftId: draft.id, parentId, index: globalIndex++, title: section.title,
        description: section.description, keyPoints: section.keyPoints,
        estimatedWords: section.estimatedWords, constraints: section.constraints, status: "pending",
      },
    });
    idMap.set(section.path.join(","), created.id);
  }

  return db.draft.findUnique({
    where: { id: draft.id },
    include: { sections: { orderBy: { index: "asc" } } },
  });
}
