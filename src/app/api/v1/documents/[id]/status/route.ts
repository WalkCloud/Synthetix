import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
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

  const task = await db.asyncTask.findFirst({
    where: {
      userId: user.id,
      type: "document_convert",
      inputData: { contains: doc.id },
    },
    orderBy: { createdAt: "desc" },
  });

  return successResponse({
    documentId: doc.id,
    status: doc.status,
    taskId: task?.id,
    taskStatus: task?.status,
    progress: task?.progress || 0,
    error: task?.errorMessage,
  });
}
