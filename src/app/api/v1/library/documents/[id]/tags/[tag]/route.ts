import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; tag: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id, tag: tagName } = await params;
  const tag = await db.tag.findUnique({ where: { name: tagName } });
  if (!tag) {
    return errorResponse("Tag not found", 404);
  }

  await db.documentTag.deleteMany({ where: { documentId: id, tagId: tag.id } });

  return successResponse(null);
}
