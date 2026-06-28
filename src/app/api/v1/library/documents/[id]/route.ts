import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { computeDocumentPipeline, computeDisplayStatus, type PipelineTaskView } from "@/lib/documents/pipeline-stages";
import { derivePipelineModes } from "@/lib/queue/workers/index-mode-flags";

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
      type: { in: ["document_convert", "rag_embed_index", "rag_index", "wiki_synthesize"] },
    },
    orderBy: { createdAt: "desc" },
    select: { type: true, status: true, progress: true, inputData: true },
  });
  const latest = (type: string) => tasks.find((t) => t.type === type);
  const convertRow = latest("document_convert");
  const embedRow = latest("rag_embed_index");
  const graphRow = latest("rag_index");
  const wikiRow = latest("wiki_synthesize");

  const toView = (t?: { status: string; progress: number }): PipelineTaskView | null =>
    t ? { status: t.status, progress: t.progress } : null;

  // graphMode / wikiEnabled: derived the SAME way as the library list — from
  // the convert task's stored options (the user's Knowledge Mode), with task
  // presence as a truthful backstop. Shared via derivePipelineModes() so the
  // list and detail views never disagree about which branches to render.
  const { graphMode, wikiEnabled } = derivePipelineModes(
    convertRow?.inputData ?? null,
    !!graphRow,
    !!wikiRow,
  );

  const pipeline = computeDocumentPipeline({
    doc: {
      status: doc.status,
      originalPath: doc.originalPath,
      conversionMethod: doc.conversionMethod,
    },
    convertTask: toView(convertRow ?? undefined),
    embedTask: toView(embedRow ?? undefined),
    graphTask: toView(graphRow ?? undefined),
    wikiTask: toView(wikiRow ?? undefined),
    graphMode,
    wikiEnabled,
  });

  return successResponse({
    ...doc,
    tags: doc.tags.map((dt) => dt.tag),
    pipeline,
    displayStatus: computeDisplayStatus(pipeline, doc.status),
  });
}
