import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { computeDocumentPipeline, computeDisplayStatus, type PipelineTaskView } from "@/lib/documents/pipeline-stages";
import { derivePipelineModes } from "@/lib/queue/workers/index-mode-flags";
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
  const tasks = await findTasksByResourceIdentity({
    userId: user.id,
    field: "documentId",
    value: id,
    types: ["document_convert", "rag_embed_index", "rag_index", "wiki_synthesize", "document_segment"],
    order: "desc",
  });
  const latest = (type: string) => tasks.find((t) => t.type === type);
  const convertRow = latest("document_convert");
  const embedRow = latest("rag_embed_index");
  const graphRow = latest("rag_index");
  const wikiRow = latest("wiki_synthesize");

  // Processing duration: split into "basic" (convert → embed, the time until
  // the document is usable for search/retrieval) and "enhancement" (graph +
  // wiki, which continue in the background). This gives users a meaningful
  // "time to usable" metric instead of a multi-hour span dominated by graph
  // generation.
  //
  // basicDurationMs: convert start → embed end (the linear pipeline).
  // enhancementDurationMs: graph/wiki start → latest graph/wiki end.
  // processingDurationMs: kept for backward compat = basic + enhancement.
  let processingDurationMs: number | null = null;
  let basicDurationMs: number | null = null;
  let enhancementDurationMs: number | null = null;
  let processingStartedAt: string | null = null;

  if (convertRow) {
    const batchStart = convertRow.createdAt;
    const batchTasks = tasks.filter((t) => t.createdAt >= batchStart);
    if (batchTasks.length > 0) {
      const earliestStart = batchTasks.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), batchStart);
      processingStartedAt = earliestStart.toISOString();

      // Basic duration: convert → embed completion (linear pipeline only).
      const basicTypes = ["document_convert", "rag_embed_index"];
      const basicFinished = batchTasks.filter(
        (t) => basicTypes.includes(t.type) && (t.status === "completed" || t.status === "failed"),
      );
      if (basicFinished.length > 0) {
        const basicEnd = basicFinished.reduce(
          (max, t) => (t.updatedAt > max ? t.updatedAt : max),
          basicFinished[0].updatedAt,
        );
        basicDurationMs = basicEnd.getTime() - earliestStart.getTime();
        if (basicDurationMs < 0) basicDurationMs = null;
      }

      // Enhancement duration: graph + wiki (background branches).
      const enhTypes = ["rag_index", "wiki_synthesize", "document_segment"];
      const enhTasks = batchTasks.filter((t) => enhTypes.includes(t.type));
      if (enhTasks.length > 0) {
        const enhStart = enhTasks.reduce(
          (min, t) => (t.createdAt < min ? t.createdAt : min),
          enhTasks[0].createdAt,
        );
        const enhFinished = enhTasks.filter((t) => t.status === "completed" || t.status === "failed");
        if (enhFinished.length > 0) {
          const enhEnd = enhFinished.reduce(
            (max, t) => (t.updatedAt > max ? t.updatedAt : max),
            enhFinished[0].updatedAt,
          );
          enhancementDurationMs = enhEnd.getTime() - enhStart.getTime();
          if (enhancementDurationMs < 0) enhancementDurationMs = null;
        }
      }

      // Total (backward compat): latest of all finished tasks.
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
    processingStartedAt,
    basicDurationMs,
    enhancementDurationMs,
  });
}
