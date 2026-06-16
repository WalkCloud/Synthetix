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

  const where: Record<string, unknown> = { userId: user.id };
  if (status) where.status = status;
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

  return NextResponse.json({
    success: true,
    data: documents.map((d) => ({
      ...d,
      tags: d.tags.map((dt) => dt.tag),
      ...(queuePositions.has(d.id) ? { queuePosition: queuePositions.get(d.id) } : {}),
    })),
    total,
    page,
    limit,
  });
}
