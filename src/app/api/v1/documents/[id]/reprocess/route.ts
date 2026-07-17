import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/auth/session";
import type { ProcessingOptions } from "@/lib/queue/types";
import { authErrorResponse, errorResponse, successResponse } from "@/lib/api-helpers";
import {
  cancelActiveDocumentConvertTasks,
  cancelActiveRagEmbedIndexTasks,
  cancelActiveFollowupTasks,
} from "@/lib/documents/processing-tasks";
import { DocumentMutationBusyError, executionRegistry, getQueue } from "@/lib/queue";
import { findTasksByResourceIdentity } from "@/lib/queue/task-identity-query";

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
    const prevTasks = await findTasksByResourceIdentity({
      userId: user.id,
      field: "documentId",
      value: id,
      types: ["document_convert"],
      order: "desc",
      take: 10,
    });
    for (const row of prevTasks) {
      if (!row.inputData) continue;
      try {
        const prev = JSON.parse(row.inputData);
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
  const existingPending = await findTasksByResourceIdentity({
    userId: user.id,
    field: "documentId",
    value: id,
    types: ["document_convert"],
    statuses: ["pending", "running"],
    order: "desc",
    take: 1,
  });
  if (existingPending[0]?.id) {
    return successResponse({ documentId: id, taskId: existingPending[0].id, deduped: true });
  }

  // Mark any older active tasks as cancelled, then BLOCK until their
  // workers actually exit. cancelActive* only flips DB status; without the
  // wait we used to delete chunks while a worker was still updating them.
  // Follow-up tasks (rag_index, wiki_synthesize) are now enqueued EARLY by
  // the embed worker (in parallel with the long graph/basic phase), so they
  // must be cancelled here too — otherwise a lingering graph extraction or
  // wiki synthesis from the old run would race the fresh convert pipeline.
  try {
    return await executionRegistry.withDocumentMutation(user.id, [id], async () => {
      const activeInsideGate = await findTasksByResourceIdentity({
        userId: user.id,
        field: "documentId",
        value: id,
        types: ["document_convert"],
        statuses: ["pending", "running"],
        order: "desc",
        take: 1,
      });
      if (activeInsideGate[0]?.id) {
        return successResponse({ documentId: id, taskId: activeInsideGate[0].id, deduped: true });
      }

      await cancelActiveDocumentConvertTasks(user.id, id);
      await cancelActiveRagEmbedIndexTasks(user.id, id);
      await cancelActiveFollowupTasks(user.id, id);
      await executionRegistry.awaitDocumentExecutions(user.id, [id]);

      await db.document.update({ where: { id }, data: { status: "queued" } });
      await db.documentChunk.deleteMany({ where: { documentId: id } });

      const taskId = await getQueue().submit("document_convert", { docId: id, options }, user.id);
      return successResponse({ documentId: id, taskId });
    });
  } catch (error) {
    if (error instanceof DocumentMutationBusyError) {
      return errorResponse({
        code: "conflict",
        message: "Document processing is still active. Try again after the current operation settles.",
      }, 409);
    }
    throw error;
  }
}
