import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { deriveDraftStatus, isSectionDone } from "@/lib/writing/status";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import type { OutlineData } from "@/types/writing";
import { resolveOutline, createDraftWithSections } from "@/lib/writing/resolve-outline";

interface CreateDraftBody {
  sessionId?: string;
  outline?: OutlineData;
}

export async function POST(request: Request): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let body: CreateDraftBody;
  try { body = (await request.json()) as CreateDraftBody; } catch { return errorResponse({ code: "invalidInput", message: "Invalid JSON body" }, 400); }

  if (!body.sessionId && !body.outline) return errorResponse({ code: "invalidInput", message: "Either sessionId or outline must be provided" }, 400);

  const result = await resolveOutline(body.sessionId, body.outline, user.id);
  if ("error" in result) return errorResponse(result.error, result.status);

  try {
    const draftWithSections = await createDraftWithSections(user.id, result.outline, result.resolvedSessionId);
    return successResponse(draftWithSections, 201);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const skip = (page - 1) * limit;

  try {
    const [drafts, total] = await Promise.all([
      db.draft.findMany({
        where: { userId: user.id }, orderBy: { updatedAt: "desc" }, skip, take: limit,
        include: { _count: { select: { sections: true } }, sections: { select: { status: true, wordCount: true, estimatedWords: true } } },
      }),
      db.draft.count({ where: { userId: user.id } }),
    ]);

    const draftsWithProgress = drafts.map((draft) => {
      const sectionCount = draft._count.sections;
      const doneCount = draft.sections.filter((s) => isSectionDone(s.status)).length;
      const acceptedCount = draft.sections.filter((s) => s.status === "locked").length;
      const wordsWritten = draft.sections.reduce((sum, s) => sum + (s.wordCount ?? 0), 0);
      const wordsEstimated = draft.sections.reduce((sum, s) => sum + (s.estimatedWords ?? 0), 0);
      const derivedStatus = deriveDraftStatus(draft.sections);
      const { sections: _removed, _count, ...draftData } = draft;
      void _removed;
      void _count;
      return { ...draftData, status: derivedStatus, sectionCount, progress: { accepted: acceptedCount, completed: doneCount, total: sectionCount, wordsWritten, wordsEstimated } };
    });

    return NextResponse.json({ success: true, data: draftsWithProgress, total, page, limit });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
