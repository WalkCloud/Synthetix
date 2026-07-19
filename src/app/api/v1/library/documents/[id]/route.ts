import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import { computeDocumentPipeline, computeDisplayStatus, type PipelineTaskView } from "@/lib/documents/pipeline-stages";
import {
  aggregateDocumentProcessingTiming,
  selectLatestDocumentProcessingRound,
} from "@/lib/documents/processing-tasks";
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
  const roundTasks = selectLatestDocumentProcessingRound(tasks);
  const latest = (type: string) => roundTasks.find((t) => t.type === type);
  const convertRow = latest("document_convert");
  const embedRow = latest("rag_embed_index");
  const graphRows = roundTasks.filter((task) => task.type === "rag_index");
  const graphRow = graphRows.reduce<(typeof graphRows)[number] | undefined>((selected, task) => {
    if (!selected) return task;
    const attemptDelta = (task.attempt ?? 0) - (selected.attempt ?? 0);
    return attemptDelta > 0 || (attemptDelta === 0 && task.createdAt > selected.createdAt) ? task : selected;
  }, undefined);
  const wikiRow = latest("wiki_synthesize");

  // The latest document_convert is the root of the displayed processing round.
  // Timing only includes tasks in that operation and remains open until every
  // task required by the selected knowledge mode reaches a terminal state.
  const {
    processingDurationMs,
    processingStartedAt,
    basicDurationMs,
    enhancementDurationMs,
  } = aggregateDocumentProcessingTiming(roundTasks);

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
