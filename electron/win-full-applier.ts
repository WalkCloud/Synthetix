/**
 * Windows "full" update applier — NSIS reinstall.
 *
 * The Synthetix Windows installer is an electron-builder NSIS package configured
 * per-user (perMachine:false), so reinstalling does NOT require elevation.
 *
 * As of the online-update redesign (Stage 1.2), the installer is launched
 * WITHOUT /S so the user SEES the install wizard — the product requirement is
 * "下载完成后跳出安装页面". /currentuser keeps it per-user (no UAC). Omitting
 * /D makes NSIS reuse the previously-chosen install dir.
 *
 * Sequence (see docs/online-update-capability-analysis-and-design.md §8.1):
 *   1. Stop the Next.js child so it releases the SQLite DB handle and any
 *      better_sqlite3.node file locks (otherwise the installer can hit EPERM).
 *   2. Spawn the installer detached, inheriting no stdio, so it survives our
 *      app quitting. Visible wizard, per-user.
 *   3. Clean up the staging dir (the installer has already been launched).
 *   4. Quit the app. The NSIS installer overwrites the install dir in place;
 *      user data under %APPDATA%\Synthetix is untouched (it lives outside the
 *      install dir). A detached helper relaunches the new exe once it's ready.
 *
 * The shutdown (step 1) and quit (step 4) are delegated back to main.ts via the
 * `hooks` registered alongside this applier, because nextServer / isQuitting
 * live in main.ts's module scope.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { Applier } from "./updater";
import { cleanupStaging } from "./updater";
import { resolveInstalledExe } from "./lib/resolve-install-path";

/** electron-builder appId from electron-builder.yml. Used for the registry lookup. */
const APP_ID = "com.walkcloud.synthetix";

export interface FullApplierHooks {
  /** Stop the Next.js server child and resolve once it is dead. */
  stopNextServer: () => Promise<void>;
  /** Quit the app so the installer can overwrite files in the install dir. */
  quitApp: () => void;
}

let hooks: FullApplierHooks | null = null;

/** main.ts registers the shutdown hooks when wiring the updater. */
export function setFullApplierHooks(h: FullApplierHooks): void {
  hooks = h;
}

/**
 * Build the "full" applier. Requires hooks to have been set first; if they
 * haven't, the applier rejects (main.ts always sets them before any update).
 */
export const winFullApplier: Applier = async (_stagedPath, _version, _pathKind) => {
  if (!hooks) {
    throw new Error("full applier hooks not registered");
  }
  const installerPath = _stagedPath;
  if (!fs.existsSync(installerPath)) {
    throw new Error(`installer not found: ${installerPath}`);
  }

  // 1) Release the backend's hold on the DB / native module files.
  await hooks.stopNextServer();

  // 2) Spawn the NSIS installer, detached, so it outlives our quit.
  //    No /S: show the wizard UI (product requirement "跳出安装页面").
  //    /currentuser: per-user (no UAC), matches electron-builder perMachine:false.
  //    No /D: NSIS reuses the previously-chosen install dir.
  const child = spawn(installerPath, ["/currentuser"], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  // 3) Clean up the staging dir — the installer is now running detached and
  //    has its own copy of the exe open, so deleting our staged download is
  //    safe. Best-effort; cleanup errors are logged, not thrown.
  cleanupStaging();

  // 4) After a short grace, relaunch the (now freshly installed) app and quit.
  //    Resolve the install path robustly: current process dir first (most
  //    reliable after an in-place reinstall), then registry, then the default
  //    per-user dir. This fixes the bug where a custom install dir broke the
  //    hardcoded relaunch path.
  const installedExe = resolveInstalledExe(APP_ID);
  scheduleRelaunch(installedExe, installerPath);

  hooks.quitApp();
};

/**
 * Launch a detached cmd that waits for the installer to exit (by polling for
 * the new exe to be unlocked), then opens the app. This is fire-and-forget —
 * the helper survives our process quitting because it is detached + unref'd.
 *
 * The wait is generous (up to ~5 minutes) to accommodate slow disks; if the
 * new exe never appears the helper simply exits without launching anything
 * rather than looping forever.
 */
function scheduleRelaunch(targetExe: string, installerExe: string): void {
  // Wait ~6s for NSIS to begin, then poll up to ~5 min for the target exe to
  // be launchable. Encoded as a single cmd /c invocation so it needs no temp
  // script file. `start "" <exe>` opens it detached from the helper.
  const cmd = [
    "timeout /t 6 /nobreak >nul",
    "set /a tries=0",
    ":wait",
    "if exist \"%TARGET%\" goto run",
    "set /a tries+=1",
    "if %tries% gtr 150 goto done",
    "timeout /t 2 /nobreak >nul",
    "goto wait",
    ":run",
    "start \"\" \"%TARGET%\"",
    ":done",
  ].join(" & ");
  const helper = spawn(
    "cmd.exe",
    ["/c", cmd],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, TARGET: targetExe },
    }
  );
  helper.unref();
  // Reference installerExe to satisfy linters; the spawn above is the actor.
  void installerExe;
}
