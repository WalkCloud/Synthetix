import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { patchOutline } from "@/lib/writing/outline-patch";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id: draftId } = await params;

  let body: { sections?: unknown[]; outline?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  try {
    const draft = await db.draft.findFirst({ where: { id: draftId, userId: user.id }, select: { id: true } });
    if (!draft) return errorResponse("Draft not found", 404);

    const updated = await patchOutline(draftId, body as { sections?: any[]; outline?: string });
    return successResponse(updated);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
