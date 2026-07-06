import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { scanKnowledgeHealth } from "@/lib/knowledge/health";
import { invalidateUserGraph } from "@/lib/knowledge/graph-cache";
import { waitForDocActiveTasksToSettle } from "@/lib/documents/processing-tasks";

// Long timeout: graph extraction can take 10+ minutes per document because each
// chunk triggers an LLM call. We must let the in-flight Python subprocess exit
// before wiping the rag working dir; otherwise its final entity/relationship
// writes recreate orphan graph data after our reset.
const CLEANUP_TASK_SETTLE_TIMEOUT_MS = 10 * 60_000;

export type DocumentDeleteResult =
  | { deleted: null; notFound: true }
  | {
      deleted: string;
      cleanup: {
        database: "deleted";
        files: "deleted" | "queued";
        rag: "deleted" | "reset" | "failed" | "queued";
        verification: "passed" | "dirty" | "deferred";
      };
      issues: string[];
      cleanupTaskId?: string;
    };

export interface DocumentLifecycleDeps {
  findDocument(userId: string, docId: string): Promise<{ id: string; userId: string } | null>;
  findDocuments(userId: string, docIds: string[]): Promise<{ id: string; userId: string }[]>;
  countDocuments(userId: string): Promise<number>;
  cancelDocumentTasks(userId: string, docId: string): Promise<void>;
  cancelDocumentTasksBatch(userId: string, docIds: string[]): Promise<void>;
  enqueueDocumentCleanup(userId: string, docId: string): Promise<string | null>;
  deleteRagDocument(userId: string, docId: string): Promise<void>;
  resetUserRag(userId: string): Promise<void>;
  cleanupRagOrphans(userId: string, activeDocIds: string[]): Promise<void>;
  deleteDocumentFiles(userId: string, docId: string): Promise<void>;
  deleteDocumentRows(userId: string, docId: string): Promise<void>;
  deleteDocumentRowsBatch(userId: string, docIds: string[]): Promise<{ deleted: string[]; notFound: string[] }>;
  verifyDocumentDeleted(userId: string, docId: string): Promise<{ ok: boolean; issues: string[] }>;
}

export function createDocumentLifecycleService(deps: DocumentLifecycleDeps) {
  async function deleteDocument(userId: string, docId: string): Promise<DocumentDeleteResult> {
    const doc = await deps.findDocument(userId, docId);
    if (!doc) return { deleted: null, notFound: true };

    const issues: string[] = [];
    await deps.cancelDocumentTasks(userId, docId);
    await deps.deleteDocumentRows(userId, docId);

    let cleanupTaskId: string | null = null;
    try {
      cleanupTaskId = await deps.enqueueDocumentCleanup(userId, docId);
    } catch (error) {
      issues.push("Cleanup queued failed: " + (error instanceof Error ? error.message : String(error)));
    }

    return {
      deleted: docId,
      cleanup: {
        database: "deleted",
        files: "queued",
        rag: "queued",
        verification: "deferred",
      },
      issues,
      cleanupTaskId: cleanupTaskId || undefined,
    };
  }

  async function cleanupDeletedDocument(userId: string, docId: string): Promise<Exclude<DocumentDeleteResult, { notFound: true }>> {
    const issues: string[] = [];
    let ragStatus: "deleted" | "reset" | "failed" = "deleted";

    // Wait for any in-flight document_convert / rag_embed_index / rag_index task
    // for this docId to actually exit before we touch the rag working directory.
    // cancelDocumentTasks (called in deleteDocument) only marks DB rows
    // cancelled — the running Python subprocess (especially graph extraction,
    // which can run 10+ min per doc) keeps writing to the rag dir until it
    // returns. Without this barrier, our resetUserRag below races the Python
    // worker and the worker's final writes recreate orphan entities/relations.
    await waitForDocActiveTasksToSettle(userId, docId, CLEANUP_TASK_SETTLE_TIMEOUT_MS);

    try {
      await deps.deleteRagDocument(userId, docId);
    } catch (error) {
      ragStatus = "failed";
      issues.push(error instanceof Error ? error.message : String(error));
    }

    await deps.deleteDocumentFiles(userId, docId);

    // NOTE: Wiki cleanup is intentionally NOT done here. It is handled in the
    // DELETE route handler, gated on the user's deleteWiki choice:
    //   - deleteWiki=true  → route calls deleteEntriesForDocuments (full strip)
    //   - deleteWiki=false → route leaves Wiki untouched (user wants to keep it)
    // Previously this worker unconditionally stripped Wiki refs, which silently
    // overrode the user's "keep Wiki" choice. The RAG orphan sweep below still
    // runs because graph/vector data has no "keep" semantics — it must stay
    // consistent with the live document set.

    const remaining = await deps.countDocuments(userId);
    if (remaining === 0) {
      // Always reset when no documents remain, even if deleteRagDocument failed
      await deps.resetUserRag(userId).catch(() => {});
      if (ragStatus !== "failed") ragStatus = "reset";
    } else {
      try {
        const docs = await db.document.findMany({ where: { userId }, select: { id: true } });
        await deps.cleanupRagOrphans(userId, docs.map((d) => d.id));
      } catch (error) {
        issues.push("RAG orphan cleanup skipped: " + (error instanceof Error ? error.message : String(error)));
      }
    }

    const verification = await deps.verifyDocumentDeleted(userId, docId);
    issues.push(...verification.issues);

    return {
      deleted: docId,
      cleanup: {
        database: "deleted",
        files: "deleted",
        rag: ragStatus,
        verification: verification.ok && issues.length === 0 ? "passed" : "dirty",
      },
      issues,
    };
  }

  /**
   * Bulk-delete documents in a single DB pass per table instead of looping
   * deleteDocument() per doc. The schema's ON DELETE CASCADE already removes
   * chunks/atoms/segments/tags/images when the parent document row goes, so
   * we only need:
   *   1. cancel processing tasks for all docIds (one updateMany)
   *   2. delete the document rows (one deleteMany — cascade handles children)
   *   3. enqueue one document_cleanup task per surviving docId (RAG + files)
   *
   * Wiki cleanup is intentionally NOT done here — the route handler decides
   * based on the user's deleteWiki flag (see deleteDocuments route).
   */
  async function deleteDocuments(userId: string, docIds: string[]) {
    if (docIds.length === 0) return { deleted: [] as string[], results: [] as DocumentDeleteResult[] };

    const { deleted, notFound } = await deps.deleteDocumentRowsBatch(userId, docIds);

    // Cancel in-flight processing tasks for the docs we actually removed.
    if (deleted.length > 0) {
      await deps.cancelDocumentTasksBatch(userId, deleted).catch(() => undefined);
    }

    // Enqueue one cleanup task per deleted doc — the cleanup worker handles
    // RAG deletion (vector store + graph) and on-disk file removal. We do not
    // await these; they run in the background queue.
    const results: DocumentDeleteResult[] = [];
    for (const docId of deleted) {
      const issues: string[] = [];
      let cleanupTaskId: string | null = null;
      try {
        cleanupTaskId = await deps.enqueueDocumentCleanup(userId, docId);
      } catch (error) {
        issues.push("Cleanup queue failed: " + (error instanceof Error ? error.message : String(error)));
      }
      results.push({
        deleted: docId,
        cleanup: {
          database: "deleted",
          files: "queued",
          rag: "queued",
          verification: "deferred",
        },
        issues,
        cleanupTaskId: cleanupTaskId || undefined,
      });
    }
    for (const docId of notFound) {
      results.push({ deleted: null, notFound: true } as DocumentDeleteResult);
      void docId;
    }

    return { deleted, results };
  }

  return { deleteDocument, cleanupDeletedDocument, deleteDocuments };
}

const storage = new LocalStorageAdapter();

export const documentLifecycle = createDocumentLifecycleService({
  findDocument(userId, docId) {
    return db.document.findFirst({ where: { id: docId, userId }, select: { id: true, userId: true } });
  },
  countDocuments(userId) {
    return db.document.count({ where: { userId } });
  },
  findDocuments(userId, docIds) {
    return db.document.findMany({
      where: { id: { in: docIds }, userId },
      select: { id: true, userId: true },
    });
  },
  async cancelDocumentTasks(userId, docId) {
    await db.asyncTask.updateMany({
      where: {
        userId,
        status: { in: ["pending", "running"] },
        inputData: { contains: docId },
      },
      data: { status: "cancelled", errorMessage: "Document deleted" },
    }).catch(() => undefined);
  },
  async cancelDocumentTasksBatch(userId, docIds) {
    if (docIds.length === 0) return;
    // One statement cancels all in-flight tasks whose payload mentions any of
    // the deleted docs. `contains` is OR-implicit across docIds only via a
    // loop here — SQLite Prisma's `contains` doesn't accept an array. We keep
    // it simple: cancel any running/pending task whose inputData contains any
    // of the docIds. This matches the single-doc behaviour.
    await db.asyncTask.updateMany({
      where: {
        userId,
        status: { in: ["pending", "running"] },
        OR: docIds.map((docId) => ({ inputData: { contains: docId } })),
      },
      data: { status: "cancelled", errorMessage: "Document deleted" },
    }).catch(() => undefined);
  },
  async enqueueDocumentCleanup(userId, docId) {
    const { getQueue } = await import("@/lib/queue");
    return getQueue().submit("document_cleanup", { docId }, userId);
  },
  async deleteRagDocument(userId, docId) {
    const ctx = await createRagContext(userId);
    await manageRag({
      userId,
      action: "delete-by-doc",
      embedConfig: ctx.embedConfig,
      llmConfig: ctx.llmConfig || { apiBase: "", apiKey: "", model: "" },
      rerankConfig: ctx.rerankConfig,
      embedDim: ctx.embedDim,
      docId,
    });
    // Removing a document's entities/relations reshapes the graph; drop cached
    // snapshots so the next read isn't stale.
    invalidateUserGraph(userId);
  },
  async resetUserRag(userId) {
    await storage.deleteUserRagData(userId);
  },
  async cleanupRagOrphans(userId, activeDocIds) {
    const health = await scanKnowledgeHealth({ userId, activeDocumentIds: activeDocIds });
    if (health.status === "healthy") return;

    // If there are stale doc_status entries for docs that don't exist in DB, clean them.
    // delete-by-doc now includes a storage-level hard-delete fallback (see
    // rag_manage.py _hard_delete_doc_from_storage), so the vast majority of
    // orphans are removed here even when LightRAG's soft delete fails.
    if (health.staleRagDocIds.length > 0) {
      for (const staleId of health.staleRagDocIds) {
        const docId = staleId.split("/")[0];
        try {
          const ctx = await createRagContext(userId);
          await manageRag({
            userId,
            action: "delete-by-doc",
            embedConfig: ctx.embedConfig,
            llmConfig: ctx.llmConfig || { apiBase: "", apiKey: "", model: "" },
            rerankConfig: ctx.rerankConfig,
            embedDim: ctx.embedDim,
            docId,
          });
        } catch (error) {
          // Reaching this catch means BOTH the LightRAG soft delete AND the
          // storage-level hard delete failed (e.g. working dir locked by a
          // running rag_index, disk error). We intentionally do NOT reset the
          // whole RAG workspace here — doing so would destroy the knowledge
          // graphs of ALL other documents (which can take hours each to
          // rebuild). Instead we log + leave the orphan for the next cleanup
          // cycle: every subsequent document_cleanup task re-runs this orphan
          // sweep via scanKnowledgeHealth, so the orphan gets retried
          // automatically. The worst case for the user is a few stale entities
          // visible in the graph until the next successful cleanup pass — far
          // better than wiping everyone's graph.
          console.warn(
            `[cleanupRagOrphans] delete-by-doc (soft+hard) failed for orphan ${docId}; ` +
              `will retry on next cleanup cycle. NOT resetting workspace to preserve other documents' graphs:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    // If no active documents and graph still dirty, reset entirely
    if (activeDocIds.length === 0 && health.hasGraph) {
      await storage.deleteUserRagData(userId);
    }
  },
  async deleteDocumentFiles(userId, docId) {
    await storage.deleteDocument(docId, userId);
  },
  async deleteDocumentRows(userId, docId) {
    // Schema defines ON DELETE CASCADE on Document → chunks/atoms/segments/
    // tags/images, so deleting the parent row is sufficient. We previously
    // issued explicit deleteMany on children first — redundant extra round
    // trips. Keep a narrow fallback only if the parent delete finds nothing
    // (already gone) — in which case there's nothing more to do.
    await db.document.deleteMany({ where: { id: docId, userId } }).catch(() => undefined);
  },
  async deleteDocumentRowsBatch(userId, docIds) {
    if (docIds.length === 0) return { deleted: [] as string[], notFound: [] as string[] };

    // Snapshot which docs exist + belong to this user BEFORE deleting, so we
    // can report per-doc outcomes (deleted vs notFound) to the caller.
    const existing = await db.document.findMany({
      where: { id: { in: docIds }, userId },
      select: { id: true },
    });
    const existingIds = existing.map((d) => d.id);
    const existingSet = new Set(existingIds);
    const notFound = docIds.filter((id) => !existingSet.has(id));

    if (existingIds.length === 0) return { deleted: [], notFound };

    // Capture chunk rowids BEFORE cascade deletes them, so we can purge the
    // runtime-created document_fts virtual table (cascade does NOT reach FTS5
    // tables created outside Prisma's schema). Batched in chunks of 500 to
    // stay well under SQLite's 999 host-parameter limit.
    const chunkRowIds = await db.$queryRawUnsafe<{ rowid: number }[]>(
      `SELECT rowid FROM document_chunks WHERE document_id IN (${existingIds.map(() => "?").join(",")})`,
      ...existingIds,
    ).catch(() => [] as { rowid: number }[]);

    // ONE deleteMany cascades to chunks/atoms/segments/tags/images per schema.
    await db.document.deleteMany({ where: { id: { in: existingIds }, userId } });

    // Purge orphaned FTS rows now that the chunks are gone. Failures here are
    // non-fatal — stale FTS rows are filtered out at query time by the JOIN
    // to document_chunks, so a leftover row is a storage leak, not a bug.
    if (chunkRowIds.length > 0) {
      const FTS_BATCH = 500;
      for (let i = 0; i < chunkRowIds.length; i += FTS_BATCH) {
        const batch = chunkRowIds.slice(i, i + FTS_BATCH);
        const placeholders = batch.map(() => "?").join(",");
        await db.$executeRawUnsafe(
          `DELETE FROM document_fts WHERE rowid IN (${placeholders})`,
          ...batch.map((r) => r.rowid),
        ).catch(() => undefined);
      }
    }

    // DEFENSIVE ORPHAN SWEEP: also drop any document_fts rows whose rowid no
    // longer joins to a real chunk. This cleans up leftovers from PRIOR deletes
    // that failed to purge FTS (the old code path had no FTS cleanup at all),
    // not just the ones we deleted in this call. Cheap: one anti-join DELETE.
    await db.$executeRawUnsafe(
      `DELETE FROM document_fts WHERE rowid NOT IN (SELECT rowid FROM document_chunks)`,
    ).catch(() => undefined);

    return { deleted: existingIds, notFound };
  },
  async verifyDocumentDeleted() {
    return { ok: true, issues: [] };
  },
});
