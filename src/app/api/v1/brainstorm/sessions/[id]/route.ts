import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const session = await db.brainstormSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);
  return successResponse(session);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  const body = await request.json();

  if (body.action === "clearOutline") {
    const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
    if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

    await db.brainstormSession.update({ where: { id }, data: { outline: null } });
    return successResponse(undefined);
  }

  if (body.action === "rename" && typeof body.title === "string" && body.title.trim()) {
    const session = await db.brainstormSession.findFirst({ where: { id, userId: user.id } });
    if (!session) return errorResponse({ code: "notFound", message: "Not found" }, 404);

    const updated = await db.brainstormSession.update({ where: { id }, data: { title: body.title.trim() } });
    return successResponse(updated);
  }

  return errorResponse({ code: "invalidInput", message: "Unknown action" }, 400);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  const { id } = await params;
  await db.brainstormSession.deleteMany({ where: { id, userId: user.id } });
  return successResponse(undefined);
}
