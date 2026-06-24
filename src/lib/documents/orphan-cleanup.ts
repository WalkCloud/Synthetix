/**
 * Startup orphan-file cleanup.
 *
 * The normal delete path (DELETE /api/v1/documents/[id] -> document_cleanup
 * queue task) removes both the DB row AND the on-disk files. But that cleanup
 * task can fail to run when:
 *   - it was queued behind a long-running document_convert and the server
 *     restarted before it got a slot (no recovery exists for cleanup tasks),
 *   - recoverOrphanedPhaseOne resubmitted a convert for an already-deleted
 *     doc, re-creating a partial directory that no cleanup ever reaches.
 *
 * This module is a safety net: on startup it scans the per-user document and
 * RAG directories and removes any docId directories / RAG entries that have no
 * corresponding Document row in the DB. It is idempotent and
 * read-verify-delete: it never touches a directory whose docId still exists.
 */

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { LocalStorageAdapter } from "@/lib/documents/storage";

const DOCUMENT_ROOT = process.env.DOCUMENT_ROOT || "./data/documents";
const RAG_ROOT = process.env.RAG_ROOT || "./data/rag";

const storage = new LocalStorageAdapter();

interface OrphanCleanupResult {
  scannedUsers: number;
  orphanDocDirsRemoved: number;
  orphanRagDirsRemoved: number;
}

function safeReadDir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Remove on-disk document/RAG directories that no longer have a Document row.
 * Call once at startup (non-blocking). Safe to run repeatedly.
 */
export async function cleanupOrphanDocumentFiles(): Promise<OrphanCleanupResult> {
  const result: OrphanCleanupResult = {
    scannedUsers: 0,
    orphanDocDirsRemoved: 0,
    orphanRagDirsRemoved: 0,
  };

  const userDirs = safeReadDir(DOCUMENT_ROOT).filter((entry) => {
    const full = path.join(DOCUMENT_ROOT, entry);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  });

  // Also consider users that have RAG data even if they have no document dir.
  const ragUsers = safeReadDir(RAG_ROOT).filter((entry) => {
    const full = path.join(RAG_ROOT, entry);
    return fs.existsSync(full) && fs.statSync(full).isDirectory();
  });
  const allUsers = new Set([...userDirs, ...ragUsers]);

  for (const userId of allUsers) {
    result.scannedUsers += 1;

    // Fetch the set of docIds this user still owns in the DB.
    let activeDocIds: Set<string>;
    try {
      const rows = await db.document.findMany({
        where: { userId },
        select: { id: true },
      });
      activeDocIds = new Set(rows.map((r) => r.id));
    } catch {
      // DB not ready during very early startup — skip this pass.
      continue;
    }

    // --- Document directories: data/documents/{userId}/{docId}/ ---
    const userDocRoot = path.join(DOCUMENT_ROOT, userId);
    for (const entry of safeReadDir(userDocRoot)) {
      const full = path.join(userDocRoot, entry);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
      if (activeDocIds.has(entry)) continue; // still owned — leave it
      try {
        fs.rmSync(full, { recursive: true, force: true });
        result.orphanDocDirsRemoved += 1;
      } catch {
        // Best-effort; will retry on next startup.
      }
    }

    // --- RAG: when the user has NO documents at all, wipe their rag dir ---
    // Per-doc RAG cleanup (delete-by-doc) is handled by the normal lifecycle;
    // here we only catch the case where a user was fully emptied but their
    // rag working directory (graph, embeddings) was never reset.
    if (activeDocIds.size === 0) {
      const userRagDir = path.join(RAG_ROOT, userId);
      const graphFile = path.join(userRagDir, "graph_chunk_entity_relation.graphml");
      if (fs.existsSync(graphFile) && fs.statSync(graphFile).size > 0) {
        try {
          await storage.deleteUserRagData(userId);
          result.orphanRagDirsRemoved += 1;
        } catch {
          // Best-effort.
        }
      }
    }
  }

  if (result.orphanDocDirsRemoved > 0 || result.orphanRagDirsRemoved > 0) {
    console.log(
      `[cleanup] removed ${result.orphanDocDirsRemoved} orphan document dir(s), ` +
      `${result.orphanRagDirsRemoved} orphan RAG dir(s) across ${result.scannedUsers} user(s)`,
    );
  }

  return result;
}
