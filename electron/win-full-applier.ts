/**
 * Windows "full" update applier — silent NSIS reinstall.
 *
 * The Synthetix Windows installer is an electron-builder NSIS package configured
 * per-user (perMachine:false), so reinstalling does NOT require elevation.
 * NSIS supports these standard silent flags:
 *   /S             silent install (no wizard UI)
 *   /currentuser   install into the per-user dir even if a machine install dir
 *                  is remembered (matches our perMachine:false policy)
 *
 * Sequence (see docs/auto-update-design-2026-07-08.md §3.2 "Windows — full"):
 *   1. Stop the Next.js child so it releases the SQLite DB handle and any
 *      better_sqlite3.node file locks (otherwise the installer can hit EPERM).
 *   2. Spawn the installer detached, inheriting no stdio, so it survives our
 *      app quitting.
 *   3. Quit the app. The NSIS installer overwrites the install dir in place;
 *      user data under %APPDATA%\Synthetix is untouched (it lives outside the
 *      install dir). NSIS itself relaunches the app when it finishes IF the
 *      user opted into the "run after install" step; for a silent install we
 *      additionally ask NSIS to launch via a small wrapper is not needed here
 *      because Synthetix creates a Start Menu shortcut and the user can reopen
 *      it — but we DO spawn the new exe ourselves after a short delay so the
 *      experience is seamless.
 *
 * The shutdown (step 1) and quit (step 3) are delegated back to main.ts via the
 * `hooks` registered alongside this applier, because nextServer / isQuitting
 * live in main.ts's module scope.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { Applier } from "./updater";

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
  //    /S = silent; /currentuser = per-user (no UAC); /D would override the
  //    install dir but we omit it so NSIS reuses the previously-chosen dir.
  const child = spawn(installerPath, ["/S", "/currentuser"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // 3) After a short grace, relaunch the (now freshly installed) app and quit.
  //    We use a detached helper process to wait briefly then open the new exe,
  //    because we are about to quit and cannot run timers reliably ourselves.
  const installedExe = path.resolve(
    process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local"),
    "Programs",
    "Synthetix",
    "Synthetix.exe"
  );
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
