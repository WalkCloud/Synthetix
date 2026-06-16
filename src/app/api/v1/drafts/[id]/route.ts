import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { deriveDraftStatus } from "@/lib/writing/status";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

const STUCK_THRESHOLD_MS = 3 * 60 * 1000;
const TRANSIENT_STATUSES = ["generating", "retrieving", "comparing"];

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;

  try {
    let draft = await db.draft.findFirst({
      where: { id, userId: user.id },
      include: {
        sections: {
          orderBy: { index: "asc" },
          include: {
            references: {
              orderBy: { relevanceScore: "desc" },
              select: {
                documentName: true,
                relevanceScore: true,
                sourceAnchor: true,
                documentId: true,
                chunkId: true,
                content: true,
                images: true,
                sourceType: true,
              },
            },
          },
        },
      },
    });

    if (!draft) {
      return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
    }

    const now = Date.now();
    const stuckSectionIds = draft.sections
      .filter((s) => {
        if (!TRANSIENT_STATUSES.includes(s.status)) return false;
        const elapsed = now - new Date(s.updatedAt).getTime();
        return elapsed > STUCK_THRESHOLD_MS;
      })
      .map((s) => s.id);

    if (stuckSectionIds.length > 0) {
      await db.section.updateMany({
        where: { id: { in: stuckSectionIds } },
        data: { status: "failed" },
      });
      const refreshed = await db.draft.findFirst({
        where: { id, userId: user.id },
        include: {
          sections: {
            orderBy: { index: "asc" },
            include: {
              references: {
                orderBy: { relevanceScore: "desc" },
                select: {
                  documentName: true,
                  relevanceScore: true,
                  sourceAnchor: true,
                  documentId: true,
                  chunkId: true,
                  content: true,
                  images: true,
                  sourceType: true,
                },
              },
            },
          },
        },
      });
      if (refreshed) draft = refreshed;
    }

    const derivedStatus = deriveDraftStatus(draft.sections);

    return successResponse({ ...draft, status: derivedStatus });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;

  try {
    const draft = await db.draft.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!draft) {
      return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
    }

    await db.draft.delete({ where: { id: draft.id } });

    return successResponse(null);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
