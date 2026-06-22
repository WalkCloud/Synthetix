import { getAuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";

/**
 * POST /api/v1/wiki/synthesize
 *
 * Manually trigger Wiki synthesis for a document (re-run the per-chunk
 * extraction + layered summary). Useful when:
 *   - The user added new documents and wants the Wiki updated immediately
 *   - A previous synthesis failed and the user wants to retry
 *   - The user wants to regenerate after editing source documents
 *
 * Body: { documentId: string }
 * Submits a wiki_synthesize task to the queue (async, non-blocking).
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return authErrorResponse();

  let body: { documentId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse({ code: "invalidBody", message: "Invalid JSON body" }, 400);
  }

  if (!body.documentId) {
    return errorResponse({ code: "missingDocumentId", message: "documentId is required" }, 400);
  }

  // Verify the document belongs to the user and is ready (chunks must exist)
  const doc = await db.document.findFirst({
    where: { id: body.documentId, userId: user.id },
    select: { id: true, status: true, originalName: true },
  });
  if (!doc) {
    return errorResponse({ code: "documentNotFound", message: "Document not found" }, 404);
  }
  if (doc.status !== "ready") {
    return errorResponse({
      code: "documentNotReady",
      message: `Document must be 'ready' before Wiki synthesis (current: ${doc.status})`,
    }, 400);
  }

  const chunkCount = await db.documentChunk.count({ where: { documentId: doc.id } });
  if (chunkCount === 0) {
    return errorResponse({ code: "noChunks", message: "Document has no chunks to synthesize" }, 400);
  }

  const { getQueue } = await import("@/lib/queue");
  const taskId = await getQueue().submit(
    "wiki_synthesize",
    { docId: doc.id },
    user.id,
  );

  return successResponse({
    taskId,
    documentId: doc.id,
    documentName: doc.originalName,
    chunkCount,
    message: "Wiki synthesis queued",
  });
}
