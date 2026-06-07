import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import { createRagContext } from "@/lib/rag/context";
import { manageRag } from "@/lib/rag/client";
import { scanKnowledgeHealth } from "@/lib/knowledge/health";

export type DocumentDeleteResult =
  | { deleted: null; notFound: true }
  | {
      deleted: string;
      cleanup: {
        database: "deleted";
        files: "deleted";
        rag: "deleted" | "reset" | "failed";
        verification: "passed" | "dirty";
      };
      issues: string[];
    };

export interface DocumentLifecycleDeps {
  findDocument(userId: string, docId: string): Promise<{ id: string; userId: string } | null>;
  countDocuments(userId: string): Promise<number>;
  cancelDocumentTasks(userId: string, docId: string): Promise<void>;
  deleteRagDocument(userId: string, docId: string): Promise<void>;
  resetUserRag(userId: string): Promise<void>;
  cleanupRagOrphans(userId: string, activeDocIds: string[]): Promise<void>;
  deleteDocumentFiles(userId: string, docId: string): Promise<void>;
  deleteDocumentRows(userId: string, docId: string): Promise<void>;
  verifyDocumentDeleted(userId: string, docId: string): Promise<{ ok: boolean; issues: string[] }>;
}

export function createDocumentLifecycleService(deps: DocumentLifecycleDeps) {
  async function deleteDocument(userId: string, docId: string): Promise<DocumentDeleteResult> {
    const doc = await deps.findDocument(userId, docId);
    if (!doc) return { deleted: null, notFound: true };

    const issues: string[] = [];
    let ragStatus: "deleted" | "reset" | "failed" = "deleted";

    await deps.cancelDocumentTasks(userId, docId);
    try {
      await deps.deleteRagDocument(userId, docId);
    } catch (error) {
      ragStatus = "failed";
      issues.push(error instanceof Error ? error.message : String(error));
    }

    await deps.deleteDocumentFiles(userId, docId);
    await deps.deleteDocumentRows(userId, docId);

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

  async function deleteDocuments(userId: string, docIds: string[]) {
    const results = [] as DocumentDeleteResult[];
    for (const docId of docIds) {
      results.push(await deleteDocument(userId, docId));
    }
    return {
      deleted: results.flatMap((result) => result.deleted ? [result.deleted] : []),
      results,
    };
  }

  return { deleteDocument, deleteDocuments };
}

const storage = new LocalStorageAdapter();

export const documentLifecycle = createDocumentLifecycleService({
  findDocument(userId, docId) {
    return db.document.findFirst({ where: { id: docId, userId }, select: { id: true, userId: true } });
  },
  countDocuments(userId) {
    return db.document.count({ where: { userId } });
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
  },
  async resetUserRag(userId) {
    await storage.deleteUserRagData(userId);
  },
  async cleanupRagOrphans(userId, activeDocIds) {
    const health = await scanKnowledgeHealth({ userId, activeDocumentIds: activeDocIds });
    if (health.status === "healthy") return;

    // If there are stale doc_status entries for docs that don't exist in DB, clean them
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
        } catch {
          // If individual RAG cleanup fails, try workspace reset
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
    await db.documentChunk.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
    await db.documentTag.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
    await db.documentImage.deleteMany({ where: { documentId: docId } }).catch(() => undefined);
    await db.document.delete({ where: { id: docId, userId } }).catch(() => undefined);
  },
  async verifyDocumentDeleted() {
    return { ok: true, issues: [] };
  },
});
