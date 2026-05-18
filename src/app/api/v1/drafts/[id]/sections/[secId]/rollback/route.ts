import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
} from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> },
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id: draftId, secId: sectionId } = await params;

  const draft = await db.draft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true },
  });
  if (!draft) {
    return errorResponse("Draft not found", 404);
  }

  const body = await request.json();
  const targetVersion = body.version;

  if (!targetVersion || typeof targetVersion !== "number") {
    return errorResponse("version (number) required", 400);
  }

  try {
    const target = await db.sectionVersion.findFirst({
      where: { sectionId, version: targetVersion },
    });

    if (!target) {
      return errorResponse(`Version ${targetVersion} not found`, 404);
    }

    await db.section.update({
      where: { id: sectionId },
      data: {
        content: target.content,
        wordCount: target.wordCount,
        status: "reviewing",
      },
    });

    return successResponse({
      rolledBack: true,
      toVersion: targetVersion,
      content: target.content,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
