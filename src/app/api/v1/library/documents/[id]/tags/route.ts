import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  const { name } = await request.json();
  if (!name || typeof name !== "string") {
    return errorResponse({ code: "invalidInput", message: "Tag name required" }, 400);
  }

  const tag = await db.tag.upsert({
    where: { name: name.toLowerCase().trim() },
    update: {},
    create: { name: name.toLowerCase().trim() },
  });

  await db.documentTag.upsert({
    where: { documentId_tagId: { documentId: id, tagId: tag.id } },
    update: {},
    create: { documentId: id, tagId: tag.id },
  });

  return successResponse(tag);
}
