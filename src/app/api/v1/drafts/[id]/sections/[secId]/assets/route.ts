import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import {
  authErrorResponse,
  errorResponse,
  successResponse,
} from "@/lib/api-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; secId: string }> }
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

  const assets = await db.sectionAsset.findMany({
    where: { draftId, sectionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      title: true,
      status: true,
      mimeType: true,
      prompt: true,
      path: true,
      createdAt: true,
    },
  });

  return successResponse(assets);
}
