import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;
  console.log("[unlock] params:", { draftId, sectionId, userId: user.id });

  let targetStatus: "reviewing" | "pending" = "reviewing";
  try {
    const body = await request.json();
    if (body.targetStatus === "pending") {
      targetStatus = "pending";
    }
  } catch {}

  try {
    const draft = await db.draft.findFirst({
      where: { id: draftId, userId: user.id },
      select: { id: true },
    });
    if (!draft) {
      return errorResponse("Draft not found", 404);
    }

    const section = await db.section.findFirst({
      where: { id: sectionId, draftId },
    });
    if (!section) {
      return errorResponse("Section not found", 404);
    }

    if (!section.content) {
      return errorResponse("Section has no content", 400);
    }

    const updated = await db.section.update({
      where: { id: sectionId },
      data: { status: targetStatus },
    });

    return successResponse(updated);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
