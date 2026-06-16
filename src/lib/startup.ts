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
  const dataDir = resolveDataDir();

  // migrate existing dev.db from project root to new data dir (one-time)
  const oldDbPath = path.join(process.cwd(), "dev.db");
  const newDbPath = resolveDbPath();
  if (fs.existsSync(oldDbPath)) {
    if (!fs.existsSync(newDbPath)) {
      fs.copyFileSync(oldDbPath, newDbPath);
      console.log(`[db] migrated existing database to ${newDbPath}`);
    } else if (fs.statSync(newDbPath).size < fs.statSync(oldDbPath).size) {
      fs.copyFileSync(oldDbPath, newDbPath);
      console.log(`[db] replaced stale database at ${newDbPath}`);
    }
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

  // Pre-load LiteLLM catalog from disk (download once if missing)
  void import("@/lib/models/model-catalog").then(({ lookupModel }) => {
    void lookupModel("gpt-4o"); // trigger ensureCatalog, non-blocking
  });
}
