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
      type: { in: ["document_convert", "rag_embed_index", "rag_index", "wiki_synthesize", "document_segment"] },
    },
    orderBy: { createdAt: "desc" },
    select: { type: true, status: true, progress: true, inputData: true, createdAt: true, updatedAt: true },
  });
  const latest = (type: string) => tasks.find((t) => t.type === type);
  const convertRow = latest("document_convert");
  const embedRow = latest("rag_embed_index");
  const graphRow = latest("rag_index");
  const wikiRow = latest("wiki_synthesize");

  // Processing duration: measured for the LATEST processing run only (a
  // reprocess creates a fresh batch of tasks). We take the latest
  // document_convert task as the batch start, then find all tasks created at
  // or after it (the same pipeline run) and compute earliest-start →
  // latest-completed-end. This avoids summing across multiple reprocess runs
  // (which would show a meaningless multi-hour span). null while still
  // processing or if no tasks exist.
  let processingDurationMs: number | null = null;
  if (convertRow) {
    const batchStart = convertRow.createdAt;
    const batchTasks = tasks.filter((t) => t.createdAt >= batchStart);
    if (batchTasks.length > 0) {
      const earliestStart = batchTasks.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), batchStart);
      const finishedTasks = batchTasks.filter((t) => t.status === "completed" || t.status === "failed");
      if (finishedTasks.length > 0) {
        const latestEnd = finishedTasks.reduce((max, t) => (t.updatedAt > max ? t.updatedAt : max), finishedTasks[0].updatedAt);
        processingDurationMs = latestEnd.getTime() - earliestStart.getTime();
        if (processingDurationMs < 0) processingDurationMs = null;
      }
    }
  }

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
    processingDurationMs,
  });
}
