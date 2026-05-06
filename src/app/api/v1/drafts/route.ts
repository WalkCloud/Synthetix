import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ApiResponse, PaginatedResponse } from "@/types/api";
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
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
}

function flattenOutlineSections(outline: OutlineData): FlatSectionInput[] {
  return outline.sections.reduce<FlatSectionInput[]>(
    (acc, section, sectionIndex) => {
      const parent: FlatSectionInput = {
        parentId: null,
        index: sectionIndex,
        title: section.title,
        description: null,
        keyPoints: section.keyPoints ? JSON.stringify(section.keyPoints) : null,
        estimatedWords: section.estimatedWords ?? null,
      };

      const children: FlatSectionInput[] = Array.isArray(section.children)
        ? section.children.map((child, childIndex) => ({
            parentId: null, // placeholder; resolved during creation
            index: sectionIndex * 100 + childIndex + 1,
            title: child.title,
            description: null,
            keyPoints: child.keyPoints
              ? JSON.stringify(child.keyPoints)
              : null,
            estimatedWords: child.estimatedWords ?? null,
          }))
        : [];

      return [...acc, parent, ...children];
    },
    []
  );
}

function isParentSection(index: number): boolean {
  return index < 100;
}

function parentIndexOf(childIndex: number): number {
  return Math.floor(childIndex / 100);
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

  // Create parent sections first to obtain IDs, then link children
  const parentSections = flatSections.filter((s) => isParentSection(s.index));

  let createdParents: Awaited<ReturnType<typeof db.section.create>>[] = [];
  for (const parent of parentSections) {
    const created = await db.section.create({
      data: {
        draftId: draft.id,
        parentId: null,
        index: parent.index,
        title: parent.title,
        description: parent.description,
        keyPoints: parent.keyPoints,
        estimatedWords: parent.estimatedWords,
        status: "pending",
      },
    });
    createdParents = [...createdParents, created];
  }

  const childSections = flatSections.filter((s) => !isParentSection(s.index));

  for (const child of childSections) {
    const parentArrayIndex = parentIndexOf(child.index);
    const parentRecord = createdParents[parentArrayIndex];
    await db.section.create({
      data: {
        draftId: draft.id,
        parentId: parentRecord?.id ?? null,
        index: child.index,
        title: child.title,
        description: child.description,
        keyPoints: child.keyPoints,
        estimatedWords: child.estimatedWords,
        status: "pending",
      },
    });
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
): Promise<NextResponse<ApiResponse>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: CreateDraftBody;
  try {
    body = (await request.json()) as CreateDraftBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.sessionId && !body.outline) {
    return NextResponse.json(
      {
        success: false,
        error: "Either sessionId or outline must be provided",
      },
      { status: 400 }
    );
  }

  const result = await resolveOutline(
    body.sessionId,
    body.outline,
    user.id
  );

  if ("error" in result) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  try {
    const draftWithSections = await createDraftWithSections(
      user.id,
      result.outline,
      result.resolvedSessionId
    );

    return NextResponse.json(
      { success: true, data: draftWithSections },
      { status: 201 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request
): Promise<NextResponse<PaginatedResponse<unknown>>> {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
        total: 0,
        page: 1,
        limit: 20,
      },
      { status: 401 }
    );
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
      const acceptedCount = draft.sections.filter(
        (s) => s.status === "accepted" || s.status === "locked"
      ).length;
      const completedCount = draft.sections.filter(
        (s) =>
          s.status === "accepted" ||
          s.status === "locked" ||
          s.status === "summarized"
      ).length;
      const wordsWritten = draft.sections.reduce(
        (sum, s) => sum + (s.wordCount ?? 0),
        0
      );
      const wordsEstimated = draft.sections.reduce(
        (sum, s) => sum + (s.estimatedWords ?? 0),
        0
      );

      const { sections: _removed, _count, ...draftData } = draft;
      void _removed;

      return {
        ...draftData,
        sectionCount,
        progress: {
          accepted: acceptedCount,
          completed: completedCount,
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
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
        total: 0,
        page,
        limit,
      },
      { status: 500 }
    );
  }
}
