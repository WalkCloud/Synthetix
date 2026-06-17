import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { computeDocumentPipeline, type PipelineTaskView } from "@/lib/documents/pipeline-stages";
import { shouldEnqueueGraphIndex } from "@/lib/queue/workers/index-mode-flags";
import type { ProcessingOptions } from "@/lib/queue/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, userId: user.id },
    include: {
      chunks: { orderBy: { index: "asc" } },
      tags: { include: { tag: true } },
      children: { select: { id: true, originalName: true, status: true } },
      parent: { select: { id: true, originalName: true } },
    },
  });

  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  // Build a task-driven Processing Pipeline view from the document's REAL
  // async_tasks (convert / embed-index / graph) so the detail page shows
  // truthful stage dots + percentages — including the graph phase, which
  // otherwise runs invisibly after the doc is already "ready".
  const tasks = await db.asyncTask.findMany({
    where: {
      userId: user.id,
      inputData: { contains: `"docId":"${id}"` },
      type: { in: ["document_convert", "rag_embed_index", "rag_index"] },
    },
    orderBy: { createdAt: "desc" },
    select: { type: true, status: true, progress: true, inputData: true },
  });
  const latest = (type: string) => tasks.find((t) => t.type === type);
  const convertRow = latest("document_convert");
  const embedRow = latest("rag_embed_index");
  const graphRow = latest("rag_index");

  const toView = (t?: { status: string; progress: number }): PipelineTaskView | null =>
    t ? { status: t.status, progress: t.progress } : null;

  // graphMode: derived from the user's original processing options (stored on
  // the document_convert task input), or truthfully true if a rag_index task
  // was ever enqueued for this doc.
  let graphMode = false;
  if (convertRow?.inputData) {
    try {
      const parsed = JSON.parse(convertRow.inputData) as { options?: ProcessingOptions };
      if (parsed.options) graphMode = shouldEnqueueGraphIndex(parsed.options);
    } catch {
      /* malformed input — ignore */
    }
  }
  graphMode = graphMode || !!graphRow;

  const pipeline = computeDocumentPipeline({
    doc: {
      status: doc.status,
      originalPath: doc.originalPath,
      conversionMethod: doc.conversionMethod,
    },
    convertTask: toView(convertRow ?? undefined),
    embedTask: toView(embedRow ?? undefined),
    graphTask: toView(graphRow ?? undefined),
    graphMode,
  });

  return successResponse({
    ...doc,
    tags: doc.tags.map((dt) => dt.tag),
    pipeline,
  });
}
