import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
  getErrorMessage,
} from "@/lib/api-helpers";

export async function GET(
  _request: Request,
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
    return errorResponse({ code: "draftNotFound", message: "Draft not found" }, 404);
  }

  try {
    const versions = await db.sectionVersion.findMany({
      where: { sectionId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        source: true,
        wordCount: true,
        modelId: true,
        createdAt: true,
        content: true,
      },
    });

    return successResponse(versions);
  } catch (error) {
    return errorResponse(error);
  }
}
