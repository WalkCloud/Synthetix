import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { findTasksByResourceIdentity } from "@/lib/queue/task-identity-query";

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

  const task = (await findTasksByResourceIdentity({
    userId: user.id,
    field: "documentId",
    value: doc.id,
    types: ["document_convert"],
    order: "desc",
    take: 1,
  }))[0] ?? null;

  const graphTask = (await findTasksByResourceIdentity({
    userId: user.id,
    field: "documentId",
    value: doc.id,
    types: ["rag_index"],
    order: "desc",
    take: 1,
  }))[0] ?? null;

  return successResponse({
    documentId: doc.id,
    status: doc.status,
    taskId: task?.id,
    taskStatus: task?.status,
    progress: task?.progress || 0,
    error: task?.errorMessage,
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
