import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/api-helpers";
import type { DocumentListParams } from "@/types/documents";

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
  userId: string,
  queuedDocIds: string[],
): Promise<Map<string, { rank: number; total: number }>> {
  if (queuedDocIds.length === 0) return new Map();

  // Order: running first, then pending in created_at order — matches
  // queue.ts:170-182 which claims pending tasks ORDER BY created_at ASC.
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
    } catch { /* ignore malformed */ }
  }

  const total = orderedDocIds.length;
  const wanted = new Set(queuedDocIds);
  const result = new Map<string, { rank: number; total: number }>();
  orderedDocIds.forEach((docId, idx) => {
    if (wanted.has(docId)) result.set(docId, { rank: idx + 1, total });
  });
  return result;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const sort = (searchParams.get("sort") || "createdAt") as NonNullable<DocumentListParams["sort"]>;
  const order = (searchParams.get("order") || "desc") as "asc" | "desc";
  const format = searchParams.get("format") || undefined;
  const status = searchParams.get("status") || undefined;
  const tag = searchParams.get("tag") || undefined;
  const tagsParam = searchParams.get("tags") || undefined;
  const tagNames = tagsParam
    ? tagsParam.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : tag
      ? [tag.toLowerCase()]
      : undefined;

  // A document is "pending" between upload and Start-Processing: the file is
  // persisted and ready to process, but the user hasn't actually kicked off the
  // pipeline yet. Surfacing those in the library is confusing — it looks like
  // processing is stuck. So we hide pending from the default list and only
  // return them when the user explicitly filters by status=pending.
  const where: Record<string, unknown> = { userId: user.id };
  if (status) {
    where.status = status;
  } else {
    where.status = { not: "pending" };
  }
  if (format) where.originalFormat = format;
  if (tagNames && tagNames.length === 1) {
    where.tags = { some: { tag: { name: tagNames[0] } } };
  } else if (tagNames && tagNames.length > 1) {
    where.tags = { some: { tag: { name: { in: tagNames } } } };
  }

  const [total, documents] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tags: { include: { tag: true } },
        chunks: { select: { id: true, title: true, tokenCount: true, headingPath: true, index: true } },
      },
    }),
  ]);

  // Annotate queued documents with their position in the document_convert queue.
  const queuedIds = documents.filter((d) => d.status === "queued").map((d) => d.id);
  const queuePositions = await resolveQueuePositions(user.id, queuedIds);

  // Compute a consistent display status for each doc so the list badge matches
  // the detail-page pipeline badge. We need each doc's latest convert/embed/
  // graph/wiki task to know whether enhancement branches are still running.
  const docIds = documents.map((d) => d.id);
  const branchTasks = docIds.length
    ? await db.asyncTask.findMany({
        where: {
          userId: user.id,
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
  const tasksByDoc = new Map<string, { convertInputData?: string; tasks: Record<string, { status: string; progress: number }>; graphTaskId?: string }>();
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

  const { computeDocumentPipeline, computeDisplayStatus } = await import("@/lib/documents/pipeline-stages");
  const { derivePipelineModes } = await import("@/lib/queue/workers/index-mode-flags");

  return NextResponse.json({
    success: true,
    data: documents.map((d) => {
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
        ...d,
        tags: d.tags.map((dt) => dt.tag),
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
    }),
    total,
    page,
    limit,
  });
}
