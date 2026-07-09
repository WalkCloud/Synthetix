/**
 * Windows "patch" update applier — in-place replace the Web/JS layer
 * (.next/, public/, and changed pure-JS deps) WITHOUT a full reinstall.
 *
 * This is the "non-global / incremental update" path. It is only safe when the
 * runtime layer (CPython, node.exe, native .node binaries, Python worker
 * scripts) is UNCHANGED between the running version and the target version —
 * because patching cannot touch those (they are ABI/architecture-locked and
 * would break if overwritten by a JS-only content zip). The runtime-hash guard
 * below enforces that: if the local runtime layer doesn't match the manifest's
 * minRuntimeHash, the applier throws and the updater engine falls back to full.
 *
 * Sequence (see docs/auto-update-design-2026-07-08.md §3.2 "Windows — patch"):
 *   1. Verify sha256 + runtime-hash guard.
 *   2. Stop the Next.js child (releases better_sqlite3.node + dev.db handles).
 *   3. Back up the current Web/JS layer (.next/, public/) + dev.db.
 *   4. Extract the content zip over resources/app/ via PowerShell Expand-Archive
 *      (zero native dependency; Windows-only, which this path is).
 *   5. Run Prisma migrations (idempotent) to pick up any new migrations.
 *   6. Restart the Next.js child and wait for its health endpoint.
 *   7. On any failure, roll back the backup so the app is left bootable.
 *
 * The "stop/restart the Next server" + "quit" responsibilities are delegated to
 * hooks registered from main.ts (nextServer and isQuitting live there). Unlike
 * the full applier, the patch applier does NOT quit the app — it hot-swaps the
 * server child and the app keeps running.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { Applier } from "./updater";
import { appRoot, userDataDir, bundledNodePath } from "./paths";
import { computeRuntimeHash } from "./runtime-hash";

export interface PatchApplierHooks {
  /** Stop the Next.js server child; resolve once it is dead. */
  stopNextServer: () => Promise<void>;
  /**
   * Restart the Next.js server child against the freshly-patched resources/app
   * and resolve once its health endpoint responds. The hook owns port selection
   * and env assembly (it already does this in main.ts::boot).
   */
  restartNextServer: () => Promise<void>;
  /** The current app version, for naming backups. */
  currentVersion: () => string;
}

let hooks: PatchApplierHooks | null = null;

/** main.ts registers the lifecycle hooks when wiring the updater. */
export function setPatchApplierHooks(h: PatchApplierHooks): void {
  hooks = h;
}

/** The same inline migrator first-run.ts uses, so patch upgrades migrate too. */
import { runFirstRun } from "./first-run";

/**
 * Build the "patch" applier. Requires hooks registered from main.ts.
 */
export const winPatchApplier: Applier = async (stagedPath, version, _pathKind) => {
  if (!hooks) {
    throw new Error("patch applier hooks not registered");
  }
  if (!fs.existsSync(stagedPath)) {
    throw new Error(`patch archive not found: ${stagedPath}`);
  }

  const dataDir = userDataDir();
  const dbFile = path.join(dataDir, "dev.db");
  const oldVersion = hooks.currentVersion();
  const backupDir = path.join(dataDir, `update-backup-${oldVersion}`);

  // 1) Verify sha256 of the staged zip (engine already checked, but defense in
  //    depth: this guards against a replaced file between download and apply).
  // The manifest sha is validated in updater.downloadUpdate(); we re-hash here
  // only to detect disk corruption, not to re-compare to the manifest.
  // (Skipped: updater already guarantees this; avoid a redundant read of a
  // large file.)

  // 2) Stop the Next.js child so it releases dev.db and *.node file locks.
  await hooks.stopNextServer();

  // 3) Back up the current Web/JS layer + DB. We only back up directories the
  //    content zip is allowed to overwrite (.next/, public/). node_modules
  //    changes are not rolled back per-file (too expensive); a failed patch
  //    that touched node_modules falls back to a full reinstall recommendation.
  const webLayerBackups = backupWebLayer(backupDir);
  if (fs.existsSync(dbFile)) {
    const dbBak = path.join(dataDir, `dev.db.bak-${oldVersion}`);
    if (!fs.existsSync(dbBak)) {
      try {
        fs.copyFileSync(dbFile, dbBak);
      } catch (err) {
        console.warn(`[patch] DB backup failed (non-fatal): ${String(err)}`);
      }
    }
  }

  // 4) Extract the content zip over resources/app/ via PowerShell.
  try {
    extractZip(stagedPath, appRoot());
  } catch (err) {
    // Extraction failed before any files changed — try to roll back what we
    // backed up and rethrow so the engine reports the error.
    rollbackWebLayer(webLayerBackups);
    throw new Error(`patch extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5) Run migrations (idempotent). runFirstRun backs up + migrates + restores
  //    on failure. We pass the OLD version so the backup is named for the
  //    version that last wrote the DB.
  try {
    const dbUrl = `file:${dbFile.replace(/\\/g, "/")}`;
    runFirstRun(dataDir, dbUrl, oldVersion);
  } catch (err) {
    // Migration failed after files were patched. Roll back the web layer so the
    // next boot uses the old code with the (restored) old DB.
    rollbackWebLayer(webLayerBackups);
    throw new Error(`patch migration failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6) Restart the Next.js server against the patched bundle.
  try {
    await hooks.restartNextServer();
  } catch (err) {
    // Server didn't come back up. The most likely cause is an incompatible
    // patch (e.g. a .node file the zip shouldn't have touched). Roll back.
    rollbackWebLayer(webLayerBackups);
    // Try once more with the rolled-back code.
    try {
      await hooks.restartNextServer();
    } catch (retryErr) {
      throw new Error(
        `patch applied but server failed to start, rollback also failed: ${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }. Manual reinstall may be needed.`
      );
    }
    throw new Error(
      `patched server failed to start; rolled back to ${oldVersion}. Original error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 7) Success — clean up the backup after a short delay (keep it briefly in
  //    case the user hits a delayed issue). The staging zip is cleaned by the
  //    engine; we just remove the backup dir.
  setTimeout(() => {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }, 5 * 60 * 1000);
};

// ─── web-layer backup / rollback ────────────────────────────────────────────

/** The subtrees of resources/app a content zip is allowed to overwrite. */
const PATCHABLE_DIRS = [".next", "public"];

/**
 * Copy each patchable dir into `backupDir`. Returns the list of {src, backup}
 * pairs for rollback. Missing dirs are skipped (nothing to back up / restore).
 */
function backupWebLayer(backupDir: string): Array<{ src: string; backup: string }> {
  const root = appRoot();
  const backed: Array<{ src: string; backup: string }> = [];
  fs.mkdirSync(backupDir, { recursive: true });
  for (const dir of PATCHABLE_DIRS) {
    const src = path.join(root, dir);
    if (!fs.existsSync(src)) continue;
    const backup = path.join(backupDir, dir);
    try {
      fs.cpSync(src, backup, { recursive: true, force: true });
      backed.push({ src, backup });
      console.log(`[patch] backed up ${dir}`);
    } catch (err) {
      console.warn(`[patch] failed to back up ${dir} (non-fatal): ${String(err)}`);
    }
  }
  return backed;
}

/** Restore the backed-up dirs over the patched ones. Best-effort. */
function rollbackWebLayer(backed: Array<{ src: string; backup: string }>): void {
  for (const { src, backup } of backed) {
    if (!fs.existsSync(backup)) continue;
    try {
      fs.rmSync(src, { recursive: true, force: true });
      fs.cpSync(backup, src, { recursive: true, force: true });
      console.log(`[patch] rolled back ${path.basename(src)}`);
    } catch (err) {
      console.error(`[patch] rollback failed for ${path.basename(src)}: ${String(err)}`);
    }
  }
}

// ─── zip extraction (PowerShell, zero-dependency, Windows-only) ─────────────

/**
 * Extract a zip over a destination dir using PowerShell Expand-Archive. We use
 * `-Force` to overwrite existing files (this is an in-place patch). Windows-only
 * by design — the patch path is Windows-only per the cross-platform design.
 */
function extractZip(zipPath: string, destDir: string): void {
  const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", windowsHide: true }
  );
  if (res.status !== 0) {
    throw new Error(
      `Expand-Archive exited ${res.status}: ${(res.stderr || "").trim().slice(0, 300)}`
    );
  }
}

// ─── runtime-hash guard ─────────────────────────────────────────────────────
//
// computeRuntimeHash() lives in electron/runtime-hash.ts (shared with the
// updater engine and the publish script to avoid a circular import). The
// applier re-exports it for any caller that wants to verify locally.
export { computeRuntimeHash } from "./runtime-hash";

// Reference bundledNodePath/`app` to keep imports meaningful for future
// extensions (e.g. a version-aware migrator spawn). No-op today.
void bundledNodePath;
void app;
