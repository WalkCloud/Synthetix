import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ProcessingOptions } from "@/lib/queue/types";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import {
  cancelActiveDocumentConvertTasks,
  cancelActiveRagEmbedIndexTasks,
  waitForDocActiveTasksToSettle,
} from "@/lib/documents/processing-tasks";
import { getQueue } from "@/lib/queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return authErrorResponse();
  }

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) {
    return errorResponse({ code: "notFound", message: "Not found" }, 404);
  }

  let options: ProcessingOptions = {};
  try {
    const body = await request.json().catch(() => ({}));
    if (body.options) options = body.options as ProcessingOptions;
  } catch { /* ignore parse errors */ }

  // Inherit the document's last processing options so that a re-index does
  // not silently drop settings the user picked at upload time — notably
  // indexMode:"graph", which is expensive to set up and was being lost on
  // reprocess because callers (UI or API) rarely re-send the full options.
  // We scan recent document_convert tasks for this doc and use the first one
  // that carries a non-empty options object. Scanning several (not just the
  // latest) matters: a prior reprocess that ran with empty {} options would
  // otherwise shadow the original graph config, so inheritance would never
  // recover it. Any field the caller explicitly provides still wins.
  if (Object.keys(options).length === 0) {
    const prevTasks = await db.$queryRawUnsafe<{ input_data: string | null }[]>(
      `SELECT input_data FROM async_tasks
       WHERE user_id = ?
         AND type = 'document_convert'
         AND input_data LIKE ?
       ORDER BY created_at DESC LIMIT 10`,
      user.id,
      `%"docId":"${id}"%`,
    );
    for (const row of prevTasks) {
      if (!row.input_data) continue;
      try {
        const prev = JSON.parse(row.input_data);
        const prevOpts = prev?.options;
        // Only inherit when the stored options actually carry meaningful
        // settings (at least one key). An empty {} (e.g. from an earlier
        // no-options reprocess) is skipped so we fall through to the real
        // original config instead.
        if (prevOpts && typeof prevOpts === "object" && Object.keys(prevOpts).length > 0) {
          options = { ...prevOpts, ...options } as ProcessingOptions;
          break;
        }
      } catch { /* malformed old task input — try the next row */ }
    }
  }

  // Dedupe: a rapid double-click or stale UI re-trigger used to enqueue two
  // full reprocess pipelines for the same docId, racing on chunks rows and
  // surfacing as the "converting → failed → ready" status flicker. If a
  // pending/running document_convert already exists for this doc, return it
  // verbatim so the caller polls the same task.
  const filter = `%"docId":"${id}"%`;
  const existingPending = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM async_tasks
     WHERE user_id = ?
       AND type = 'document_convert'
       AND status IN ('pending', 'running')
       AND input_data LIKE ?
     ORDER BY created_at DESC LIMIT 1`,
    user.id,
    filter,
  );
  if (existingPending[0]?.id) {
    return successResponse({ documentId: id, taskId: existingPending[0].id, deduped: true });
  }

  // Mark any older active tasks as cancelled, then BLOCK until their
  // workers actually exit. cancelActive* only flips DB status; without the
  // wait we used to delete chunks while a worker was still updating them.
  await cancelActiveDocumentConvertTasks(user.id, id);
  await cancelActiveRagEmbedIndexTasks(user.id, id);
  await waitForDocActiveTasksToSettle(user.id, id);

  await db.document.update({ where: { id }, data: { status: "queued" } });
  await db.documentChunk.deleteMany({ where: { documentId: id } }).catch(() => {});

  const taskId = await getQueue().submit("document_convert", { docId: id, options }, user.id);

  return successResponse({ documentId: id, taskId });
}
