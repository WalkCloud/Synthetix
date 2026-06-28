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
        select: { type: true, status: true, progress: true, inputData: true },
      })
    : [];
  // Index tasks by docId for quick lookup (latest of each type per doc).
  const tasksByDoc = new Map<string, Record<string, { status: string; progress: number }>>();
  for (const t of branchTasks) {
    try {
      const parsed = JSON.parse(t.inputData ?? "{}") as { docId?: string };
      const did = parsed.docId;
      if (!did || !docIds.includes(did)) continue;
      const bucket = tasksByDoc.get(did) ?? {};
      if (!bucket[t.type]) bucket[t.type] = { status: t.status, progress: t.progress };
      tasksByDoc.set(did, bucket);
    } catch {
      /* malformed input — skip */
    }
  }

  const { computeDocumentPipeline, computeDisplayStatus } = await import("@/lib/documents/pipeline-stages");

  return NextResponse.json({
    success: true,
    data: documents.map((d) => {
      const bucket = tasksByDoc.get(d.id) ?? {};
      const convertRow = bucket["document_convert"];
      const embedRow = bucket["rag_embed_index"];
      const graphRow = bucket["rag_index"];
      const wikiRow = bucket["wiki_synthesize"];
      // graphMode / wikiEnabled: truthfully true if the corresponding enhancement
      // task was ever enqueued for this doc (so the branch renders at all).
      const graphMode = !!graphRow;
      const wikiEnabled = !!wikiRow;
      const pipeline = computeDocumentPipeline({
        doc: { status: d.status, originalPath: d.originalPath, conversionMethod: d.conversionMethod },
        convertTask: convertRow ?? null,
        embedTask: embedRow ?? null,
        graphTask: graphRow ?? null,
        wikiTask: wikiRow ?? null,
        graphMode,
        wikiEnabled,
      });
      return {
        ...d,
        tags: d.tags.map((dt) => dt.tag),
        displayStatus: computeDisplayStatus(pipeline, d.status),
        ...(queuePositions.has(d.id) ? { queuePosition: queuePositions.get(d.id) } : {}),
      };
    }),
    total,
    page,
    limit,
  });
}
