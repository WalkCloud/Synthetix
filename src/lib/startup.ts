/**
 * Node.js-only startup logic, loaded exclusively by instrumentation.ts
 * when NEXT_RUNTIME === "nodejs".  Keeping this in a separate module
 * prevents the Edge Runtime static analyser from flagging Node.js APIs
 * inside instrumentation.ts itself.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { resolveDataDir, resolveDbPath } from "@/lib/db-path";
import { getQueue } from "@/lib/queue";

export async function startup(): Promise<void> {
  // Ensure the data directory exists (resolveDataDir creates it as a side effect).
  void resolveDataDir();

  // Migrate a legacy dev.db from the project root into the data dir.
  // One-time only: copy when the target does not yet exist.
  // NOTE: the previous "replace if old is larger" branch was removed — it could
  // silently overwrite the user's current database whenever a stale, larger dev.db
  // happened to sit in the project root (e.g. after a clone or a post-migration
  // shrink), causing real data loss. See docs/CODE-REVIEW-OPTIMIZATION-PLAN.md §2.1.
  const oldDbPath = path.join(process.cwd(), "dev.db");
  const newDbPath = resolveDbPath();
  if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
    fs.copyFileSync(oldDbPath, newDbPath);
    console.log(`[db] migrated existing database to ${newDbPath}`);
  }

  // auto-create schema if database is empty/missing (MUST run before first PrismaClient import)
  const dbFile = resolveDbPath();
  if (!fs.existsSync(dbFile)) {
    console.log("[db] database file not found, creating schema...");
    try {
      execSync("npx prisma db push", {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 60000,
      });
      console.log("[db] schema created successfully");
    } catch (e) {
      console.warn("[db] schema creation failed:", (e as Error).message);
    }
  }

  const queue = getQueue();
  void queue.processNext();
  console.log("[queue] Task queue initialized");

  // Safety-net: remove on-disk document/RAG directories whose Document row was
  // deleted but whose cleanup task never ran (e.g. queued behind a long task
  // when the server restarted). Non-blocking — runs once at boot.
  void import("@/lib/documents/orphan-cleanup").then(({ cleanupOrphanDocumentFiles }) => {
    void cleanupOrphanDocumentFiles().catch(() => undefined);
  });

  // Pre-load LiteLLM catalog from disk (download once if missing)
  void import("@/lib/models/model-catalog").then(({ lookupModel }) => {
    void lookupModel("gpt-4o"); // trigger ensureCatalog, non-blocking
  });
}
