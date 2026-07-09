/**
 * Shared, task-driven display-status computation for document lists.
 *
 * Both the documents-library list API (`/api/v1/library/documents`) and the
 * dashboard recent-documents API (`/api/v1/documents`) MUST derive a document's
 * on-screen status from the SAME source — the real async_tasks pipeline — via
 * `computeDisplayStatus`. Otherwise the two surfaces disagree (e.g. a doc whose
 * coarse `Document.status` column is stale at "ready" while a graph task has
 * actually "failed" shows differently on the library vs the dashboard).
 *
 * This module centralizes that computation so the library list, the dashboard,
 * and the detail page can never diverge. It was extracted verbatim from the
 * library route's per-row annotation logic.
 *
 * Pure-ish: it does ONE batched DB read (the latest branch tasks per doc) plus
 * the queue-position resolution, then delegates the deterministic mapping to the
 * pure `pipeline-stages` helpers.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { computeDocumentPipeline, computeDisplayStatus } from "@/lib/documents/pipeline-stages";
import { derivePipelineModes } from "@/lib/queue/workers/index-mode-flags";

/** Minimal shape of a document row this helper needs to read. */
export interface DisplayStatusDoc {
  id: string;
  status: string;
  originalPath?: string | null;
  conversionMethod?: string | null;
}

export interface QueuePosition {
  rank: number;
  total: number;
}

/**
 * The extra fields this helper attaches to each document row. The caller is
 * expected to merge these onto its own response payload (spread after the row
 * so these win, matching the original library-route behavior).
 */
export interface DisplayStatusAnnotation {
  displayStatus: ReturnType<typeof computeDisplayStatus>;
  overallPercent: number | null;
  activeStageKey: string | null;
  graphTaskId?: string;
  queuePosition?: QueuePosition;
}

/**
 * Resolves which queued documents on the current page are 1st, 2nd, ... in the
 * global document_convert queue. We can't rely solely on Document.createdAt
 * because reprocessing reuses the same row — the actual queue order is the
 * order of pending/running document_convert tasks for this user.
 *
 * Returns a Map<docId, { rank, total }> where rank is 1-indexed and total is
 * the user's total in-flight queue size (running + pending). The currently
 * running task gets rank 1.
 */
async function resolveQueuePositions(
  db: PrismaClient,
  userId: string,
  queuedDocIds: string[],
): Promise<Map<string, QueuePosition>> {
  if (queuedDocIds.length === 0) return new Map();

  // Order: running first, then pending in created_at order — matches
  // queue.ts which claims pending tasks ORDER BY created_at ASC.
  const tasks = await db.$queryRawUnsafe<{ input_data: string | null; status: string }[]>(
    `SELECT input_data, status FROM async_tasks
     WHERE user_id = ?
       AND type = 'document_convert'
       AND status IN ('pending', 'running')
     ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at ASC`,
    userId,
  );

  const orderedDocIds: string[] = [];
  for (const t of tasks) {
    if (!t.input_data) continue;
    try {
      const parsed = JSON.parse(t.input_data) as { docId?: string };
      if (parsed.docId) orderedDocIds.push(parsed.docId);
    } catch {
      /* ignore malformed */
    }
  }

  const total = orderedDocIds.length;
  const wanted = new Set(queuedDocIds);
  const result = new Map<string, QueuePosition>();
  orderedDocIds.forEach((docId, idx) => {
    if (wanted.has(docId)) result.set(docId, { rank: idx + 1, total });
  });
  return result;
}

/**
 * Annotate a page of documents with a consistent, task-driven display status.
 *
 * @param db        Prisma client.
 * @param userId    The owner of the documents (scopes the task/queue queries).
 * @param documents The document rows already fetched for the current page. Only
 *                  the fields in {@link DisplayStatusDoc} are read; any extra
 *                  fields are preserved untouched by the caller.
 * @returns A parallel array of annotations (same length/order as `documents`),
 *          one per row, to be spread onto each response payload.
 */
export async function annotateDocumentsWithDisplayStatus<T extends DisplayStatusDoc>(
  db: PrismaClient,
  userId: string,
  documents: T[],
): Promise<DisplayStatusAnnotation[]> {
  // Annotate queued documents with their position in the document_convert queue.
  const queuedIds = documents.filter((d) => d.status === "queued").map((d) => d.id);
  const queuePositions = await resolveQueuePositions(db, userId, queuedIds);

  // Compute a consistent display status for each doc so the list badge matches
  // the detail-page pipeline badge. We need each doc's latest convert/embed/
  // graph/wiki task to know whether enhancement branches are still running.
  const docIds = documents.map((d) => d.id);
  const branchTasks = docIds.length
    ? await db.asyncTask.findMany({
        where: {
          userId,
          inputData: { contains: `"docId":"` },
          type: { in: ["document_convert", "rag_embed_index", "rag_index", "wiki_synthesize"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, type: true, status: true, progress: true, inputData: true },
      })
    : [];

  // Index tasks by docId for quick lookup (latest of each type per doc).
  // We keep the convert task's inputData so we can read the user's Knowledge
  // Mode (graphMode/wikiEnabled) from the stored options — matching the detail
  // page exactly, even before enhancement tasks start.
  const tasksByDoc = new Map<
    string,
    { convertInputData?: string; tasks: Record<string, { status: string; progress: number }>; graphTaskId?: string }
  >();
  for (const t of branchTasks) {
    try {
      const parsed = JSON.parse(t.inputData ?? "{}") as { docId?: string };
      const did = parsed.docId;
      if (!did || !docIds.includes(did)) continue;
      const entry = tasksByDoc.get(did) ?? { tasks: {} };
      if (t.type === "document_convert" && !entry.convertInputData) {
        entry.convertInputData = t.inputData ?? undefined;
      }
      if (!entry.tasks[t.type]) entry.tasks[t.type] = { status: t.status, progress: t.progress };
      // Track the latest rag_index task id per doc so the list can offer Cancel.
      if (t.type === "rag_index" && (t.status === "running" || t.status === "pending")) {
        entry.graphTaskId = t.id;
      }
      tasksByDoc.set(did, entry);
    } catch {
      /* malformed input — skip */
    }
  }

  return documents.map((d) => {
    const entry = tasksByDoc.get(d.id);
    const bucket = entry?.tasks ?? {};
    const convertRow = bucket["document_convert"];
    const embedRow = bucket["rag_embed_index"];
    const graphRow = bucket["rag_index"];
    const wikiRow = bucket["wiki_synthesize"];
    // graphMode / wikiEnabled: derived the SAME way as the detail page — from
    // the convert task's stored options (the user's Knowledge Mode), with task
    // presence as a truthful backstop. This keeps the list's pipeline/branch
    // rendering identical to the detail page's.
    const { graphMode, wikiEnabled } = derivePipelineModes(entry?.convertInputData, !!graphRow, !!wikiRow);
    const pipeline = computeDocumentPipeline({
      doc: { status: d.status, originalPath: d.originalPath, conversionMethod: d.conversionMethod },
      convertTask: convertRow ?? null,
      embedTask: embedRow ?? null,
      graphTask: graphRow ?? null,
      wikiTask: wikiRow ?? null,
      graphMode,
      wikiEnabled,
    });
    // The first active stage's i18n key (e.g. "stageConvert") so the list can
    // show "转换中 30%" / "图谱 65%" alongside a single unified progress bar.
    // overallPercent already aggregates across ALL stages + branches (0-100),
    // so the list's progress matches the detail page and never freezes at one
    // stage's number.
    const activeStage = [...pipeline.stages, ...pipeline.branches].find((s) => s.status === "active");
    return {
      displayStatus: computeDisplayStatus(pipeline, d.status),
      // Truthful cross-stage progress for the list's progress bar. Null when
      // the doc isn't processing (ready/pending/failed) so the UI shows a
      // static badge instead of a stale percentage.
      overallPercent: pipeline.isProcessing ? pipeline.overallPercent : null,
      activeStageKey: activeStage?.key ?? null,
      // rag_index task id (if running) so the list can show a Cancel button.
      graphTaskId: entry?.graphTaskId,
      ...(queuePositions.has(d.id) ? { queuePosition: queuePositions.get(d.id) } : {}),
    };
  });
}
