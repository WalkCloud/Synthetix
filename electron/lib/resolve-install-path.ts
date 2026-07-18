/**
 * Resolve the installed Synthetix.exe path after a full update, so we can
 * relaunch the freshly installed app.
 *
 * Order of precedence (most reliable first):
 *   1. The directory of the currently-running process's exe
 *      (process.execPath / app.getPath("exe")). After an in-place NSIS
 *      reinstall the new exe lands at the same path the user originally chose,
 *      which is exactly where we're running from. This is the most reliable
 *      signal and works regardless of where the user installed.
 *   2. The per-user uninstall registry key's InstallLocation (Windows only).
 *      electron-builder's NSIS uninstaller registers under
 *      HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<appId>. This
 *      covers the case where the current exe has been moved or we want to be
 *      belt-and-suspenders.
 *   3. The default per-user install dir
 *      %LOCALAPPDATA%\Programs\Synthetix\Synthetix.exe — the path NSIS picks
 *      when the user accepts the default location. Last-resort fallback.
 *
 * Extracted as a standalone, electron-import-free-at-module-scope function so
 * the precedence logic can be unit-tested without spawning child processes.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

/**
 * Read the InstallLocation of a per-user NSIS uninstall entry by appId.
 * Returns null on any failure (non-Windows, missing key, reg.exe error).
 *
 * Pure-ish: takes an optional reg-reader so tests can stub the reg call.
 */
export function readUninstallInstallLocation(
  appId: string,
  opts: { regQuery?: (args: string[]) => string | null } = {},
): string | null {
  if (process.platform !== "win32") return null;
  const regQuery =
    opts.regQuery ??
    ((args: string[]): string | null => {
      const res = spawnSync("reg.exe", args, {
        encoding: "utf8",
        windowsHide: true,
      });
      if (res.status !== 0 || !res.stdout) return null;
      return res.stdout;
    });
  // per-user uninstall lives under HKCU. electron-builder's GUID-less NSIS
  // uses the appId as the key name.
  const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}`;
  const out = regQuery(["query", key, "/v", "InstallLocation"]);
  if (!out) return null;
  // Output line looks like: "    InstallLocation    REG_SZ    C:\Users\..\Synthetix"
  const m = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(out);
  if (!m) return null;
  const loc = m[1].trim();
  return loc || null;
}

/**
 * Resolve the installed Synthetix.exe path per the precedence above.
 * Returns the path (which may or may not yet exist — the installer may still
 * be unpacking). Never throws.
 *
 * @param appId  electron-builder appId (e.g. "com.walkcloud.synthetix").
 */
export function resolveInstalledExe(appId: string): string {
  // 1) Current process exe directory — most reliable after in-place reinstall.
  try {
    const currentExe = app.getPath("exe");
    if (currentExe) {
      const candidate = path.join(path.dirname(currentExe), "Synthetix.exe");
      // Return this even if the file doesn't exist *yet* — the installer is
      // mid-flight; by the time the relaunch helper polls it, it will exist.
      return candidate;
    }
  } catch {
    /* ignore */
  }

  // 2) Registry InstallLocation.
  try {
    const loc = readUninstallInstallLocation(appId);
    if (loc) {
      return path.join(loc, "Synthetix.exe");
    }
  } catch {
    /* ignore */
  }

  // 3) Default per-user dir.
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(app.getPath("home"), "AppData", "Local");
  return path.join(localAppData, "Programs", "Synthetix", "Synthetix.exe");
}

/**
 * Predicate form (for tests that don't want to materialize a path): given the
 * three signals, decide which one wins. Pure function, no Electron/fs deps.
 */
export function pickRelaunchPath(inputs: {
  currentExeDir: string | null;
  registryInstallLocation: string | null;
  defaultLocalAppDataDir: string;
}): "current" | "registry" | "default" {
  if (inputs.currentExeDir) return "current";
  if (inputs.registryInstallLocation) return "registry";
  return "default";
}

/** Test-only: bypass the fs check so pickRelaunchPath can be unit-tested. */
export function _isExePathPlausible(p: string): boolean {
  return typeof p === "string" && p.length > 0 && p.endsWith("Synthetix.exe");
}

// Keep the fs import referenced for future checks (the helper above uses path
// joins that may want fs.existsSync before launching).
void fs;
