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

  // Use raw query for precise inputData match — Prisma's JSON contains
  // can match old tasks whose inputData happens to contain a similar UUID
  const task = await db.$queryRawUnsafe<{ id: string; status: string; progress: number; error_message: string | null }[]>(
    `SELECT id, status, progress, error_message FROM async_tasks
     WHERE user_id = ? AND type = 'document_convert'
       AND input_data LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    user.id,
    `%${doc.id}%`,
  ).then((rows) => rows[0] || null);

  const graphTask = await db.asyncTask.findFirst({
    where: {
      userId: user.id,
      type: "rag_index",
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
    error: task?.error_message,
    // Surface silent pipeline downgrades (e.g. graph→basic when the embedding
    // dim is below 1536) so the UI can warn the user instead of showing an
    // empty knowledge graph with no explanation.
    warning: doc.conversionWarning,
    graph: {
      requested: Boolean(graphTask),
      taskId: graphTask?.id,
      status: graphTask?.status || "not_requested",
      progress: graphTask?.progress || 0,
      error: graphTask?.errorMessage,
    },
  });
}
