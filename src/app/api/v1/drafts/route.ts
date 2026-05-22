import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { isSectionDone, deriveDraftStatus, CONFIRMED_SECTION_STATUSES } from "@/types/writing";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
} from "@/lib/api-helpers";
import type { OutlineData } from "@/types/writing";

interface CreateDraftBody {
  sessionId?: string;
  outline?: OutlineData;
}

function isValidOutline(outline: unknown): outline is OutlineData {
  if (typeof outline !== "object" || outline === null) return false;
  const obj = outline as Record<string, unknown>;
  if (typeof obj.title !== "string" || obj.title.trim().length === 0)
    return false;
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

async function resolveOutline(
  sessionId: string | undefined,
  directOutline: OutlineData | undefined,
  userId: string
): Promise<OutlineResult> {
  if (directOutline) {
    if (!isValidOutline(directOutline)) {
      return { error: "Invalid outline structure", status: 400 };
    }
    return { outline: directOutline, resolvedSessionId: sessionId ?? null };
  }

  if (!sessionId) {
    return {
      error: "Either sessionId or outline must be provided",
      status: 400,
    };
  }

  const session = await db.brainstormSession.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    return { error: "Brainstorm session not found", status: 404 };
  }

  if (!session.outline) {
    return {
      error: "Session does not have a generated outline",
      status: 400,
    };
  }

  try {
    const parsed = JSON.parse(session.outline) as unknown;
    if (!isValidOutline(parsed)) {
      return { error: "Session outline is invalid", status: 400 };
    }
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

interface OutlineSectionLike {
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

function buildHiddenConstraints(section: OutlineSectionLike): string | null {
  const constraints: Record<string, unknown> = {};
  if (section.num) {
    constraints.outlineNumber = section.num;
  }
  if (section.writingRequirements) {
    constraints.writingRequirements = section.writingRequirements;
  }
  if (section.retrievalQuery) {
    constraints.retrievalQuery = section.retrievalQuery;
  }
  if (section.referenceHints && section.referenceHints.length > 0) {
    constraints.referenceHints = section.referenceHints;
  }

  return Object.keys(constraints).length > 0
    ? JSON.stringify(constraints)
    : null;
}

function flattenRecursive(
  sections: OutlineSectionLike[],
  parentPath: number[],
  depth: number
): FlatSectionInput[] {
  const result: FlatSectionInput[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const currentPath = [...parentPath, i];
    result.push({
      parentId: null,
      index: i,
      title: section.title,
      description: section.description ?? null,
      keyPoints: section.keyPoints ? JSON.stringify(section.keyPoints) : null,
      estimatedWords: section.estimatedWords ?? null,
      constraints: buildHiddenConstraints(section),
      depth,
      path: currentPath,
    });
    if (section.children && section.children.length > 0) {
      result.push(...flattenRecursive(section.children, currentPath, depth + 1));
    }
  }
  return result;
}

function flattenOutlineSections(outline: OutlineData): FlatSectionInput[] {
  return flattenRecursive(outline.sections, [], 0);
}

async function createDraftWithSections(
  userId: string,
  outline: OutlineData,
  sessionId: string | null
) {
  const draft = await db.draft.create({
    data: {
      userId,
      title: outline.title,
      outline: JSON.stringify(outline),
      status: "drafting",
      sessionId,
    },
  });

  const flatSections = flattenOutlineSections(outline);
  const idMap = new Map<string, string>();

  let globalIndex = 0;
  for (const section of flatSections) {
    const parentPathKey = section.path.slice(0, -1).join(",");
    const parentId = section.depth > 0 ? (idMap.get(parentPathKey) ?? null) : null;

    const created = await db.section.create({
      data: {
        draftId: draft.id,
        parentId,
        index: globalIndex++,
        title: section.title,
        description: section.description,
        keyPoints: section.keyPoints,
        estimatedWords: section.estimatedWords,
        constraints: section.constraints,
        status: "pending",
      },
    });

    idMap.set(section.path.join(","), created.id);
  }

  return db.draft.findUnique({
    where: { id: draft.id },
    include: {
      sections: {
        orderBy: { index: "asc" },
      },
    },
  });
}

export async function POST(
  request: Request
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  let body: CreateDraftBody;
  try {
    body = (await request.json()) as CreateDraftBody;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.sessionId && !body.outline) {
    return errorResponse(
      "Either sessionId or outline must be provided",
      400
    );
  }

  const result = await resolveOutline(
    body.sessionId,
    body.outline,
    user.id
  );

  if ("error" in result) {
    return errorResponse(result.error, result.status);
  }

  try {
    const draftWithSections = await createDraftWithSections(
      user.id,
      result.outline,
      result.resolvedSessionId
    );

    return successResponse(draftWithSections, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export const dynamic = "force-dynamic";

export async function GET(
  request: Request
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 20)
  );
  const skip = (page - 1) * limit;

  try {
    const [drafts, total] = await Promise.all([
      db.draft.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
        include: {
          _count: {
            select: { sections: true },
          },
          sections: {
            select: {
              status: true,
              wordCount: true,
              estimatedWords: true,
            },
          },
        },
      }),
      db.draft.count({ where: { userId: user.id } }),
    ]);

    const draftsWithProgress = drafts.map((draft) => {
      const sectionCount = draft._count.sections;
      const doneCount = draft.sections.filter((s) => isSectionDone(s.status)).length;
      const acceptedCount = draft.sections.filter(
        (s) => s.status === "locked"
      ).length;
      const wordsWritten = draft.sections.reduce(
        (sum, s) => sum + (s.wordCount ?? 0),
        0
      );
      const wordsEstimated = draft.sections.reduce(
        (sum, s) => sum + (s.estimatedWords ?? 0),
        0
      );

      const derivedStatus = deriveDraftStatus(draft.sections);

      const { sections: _removed, _count, ...draftData } = draft;
      void _removed;

      return {
        ...draftData,
        status: derivedStatus,
        sectionCount,
        progress: {
          accepted: acceptedCount,
          completed: doneCount,
          total: sectionCount,
          wordsWritten,
          wordsEstimated,
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: draftsWithProgress,
      total,
      page,
      limit,
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
