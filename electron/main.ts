/**
 * Synthetix Electron main process.
 *
 * Responsibilities:
 *  - Single-instance lock (only one backend may run).
 *  - First-run setup (secrets + DB migration) before the server starts.
 *  - Assemble the env vars the Next.js server needs to find its data dir and
 *    the bundled Python runtime, then spawn `next start` as a background child.
 *  - Wait for the server's health endpoint, then open the app window.
 *  - System tray: close-to-tray, quit kills the child cleanly.
 *
 * The Next.js server's cwd is resources/app/ (where workers/ and .next live),
 * because four server-side call sites resolve Python scripts via path.resolve()
 * against cwd. All writable data is redirected to userData through env vars,
 * which take precedence over cwd-relative defaults in the app's path resolution
 * (src/lib/db-path.ts reads DATABASE_URL/DB_PATH; storage routes read DATA_DIR).
 */
import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, ipcMain } from "electron";
import { ChildProcess, spawn } from "child_process";
import path from "path";
import http from "http";
import fs from "fs";
import {
  appRoot,
  userDataDir,
  pythonPath,
  nextCliPath,
  bundledNodePath,
  envFilePath,
} from "./paths";
import { runFirstRun } from "./first-run";
import * as updater from "./updater";
import { winFullApplier, setFullApplierHooks } from "./win-full-applier";
import { winPatchApplier, setPatchApplierHooks } from "./win-patch-applier";

// ─── globals ────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nextServer: ChildProcess | null = null;
let isQuitting = false;
// The port + dataDir the booted Next server used. Captured by boot() so the
// patch applier can restart the server against a freshly-patched bundle without
// re-running the full boot sequence (first-run, tray creation, etc.).
let bootedPort: number | null = null;
let bootedDataDir: string | null = null;

// ─── auto-update wiring ─────────────────────────────────────────────────────
// The appliers need to stop / restart the Next child and (for full) quit the
// app; all of those operate on globals in THIS module, so we hand the appliers
// callbacks (rather than exporting the globals). Registered once, at module
// load, before any update can run.
setFullApplierHooks({
  stopNextServer: () =>
    new Promise<void>((resolve) => {
      if (!nextServer) {
        resolve();
        return;
      }
      isQuitting = true; // suppress the "unexpected exit" error dialog
      gracefullyKill(nextServer, () => {
        nextServer = null;
        resolve();
      });
    }),
  quitApp: () => {
    isQuitting = true;
    app.quit();
  },
});
setPatchApplierHooks({
  stopNextServer: () =>
    new Promise<void>((resolve) => {
      if (!nextServer) {
        resolve();
        return;
      }
      // For patch we do NOT set isQuitting — the app stays alive, we're just
      // cycling the server child to release file locks before overwriting .next/.
      const child = nextServer;
      nextServer = null;
      gracefullyKill(child, () => resolve());
    }),
  restartNextServer: () =>
    new Promise<void>((resolve, reject) => {
      if (bootedPort === null || bootedDataDir === null) {
        reject(new Error("cannot restart server before initial boot completed"));
        return;
      }
      startNextServer(bootedPort, bootedDataDir);
      waitForServer(bootedPort)
        .then(() => {
          // Reload the patched UI in the existing window so the user sees the
          // new version without manually refreshing.
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.loadURL(`http://${HOST}:${bootedPort}`);
          }
          resolve();
        })
        .catch(reject);
    }),
  currentVersion: () => app.getVersion(),
});
updater.registerApplier("full", winFullApplier);
updater.registerApplier("patch", winPatchApplier);

const HOST = "127.0.0.1";

// ─── single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance — focus our window instead.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot).catch((err) => fatalBootError(err));
}

// ─── title bar overlay color sync ───────────────────────────────────────────
// The renderer sends the current theme background color (light/dark) so the
// titleBarOverlay matches the page. Invoked from preload when next-themes
// resolves/changes. Falls back to no-op if the platform/Window lacks overlay
// support (setTitleBarOverlay is Windows-only).
ipcMain.handle("synthetix:set-titlebar-color", (_event, bg: string, symbol: string) => {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === "function") {
    try {
      mainWindow.setTitleBarOverlay({ color: bg, symbolColor: symbol });
    } catch {
      // Older Windows / unsupported — ignore.
    }
  }
  return true;
});

// ─── port selection ─────────────────────────────────────────────────────────
/**
 * Find the first free TCP port in [start, start+range). Binds to 0.0.0.0 (not
 * just 127.0.0.1) so the probe matches what `next start` will actually try to
 * bind — a probe on 127.0.0.1 alone can report a port free that 0.0.0.0 binding
 * then fails on (the classic Windows 0.0.0.0:3000 vs 127.0.0.1:3000 mismatch).
 */
function pickFreePort(start: number, range = 100): Promise<number> {
  return new Promise((resolve, reject) => {
    const net = require("net");
    let port = start;
    const tryPort = () => {
      if (port >= start + range) {
        reject(new Error(`no free port in [${start}, ${start + range})`));
        return;
      }
      const server = net.createServer();
      server.unref();
      server.on("error", () => {
        port += 1;
        tryPort();
      });
      // Bind on "::" / false (all interfaces, both stacks) to mirror next start.
      server.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
        const bound = (server.address() as any).port;
        server.close(() => resolve(bound));
      });
    };
    tryPort();
  });
}

// ─── health check ───────────────────────────────────────────────────────────
/** Poll the server root until it responds, up to `timeoutMs`. */
function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { hostname: HOST, port, path: "/", timeout: 2000 },
        (res) => {
          // Any HTTP response means the server is up.
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`server did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 500);
        }
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`server did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

// ─── boot sequence ──────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  const dataDir = userDataDir();
  const dbUrl = `file:${path.join(dataDir, "dev.db").replace(/\\/g, "/")}`;

  // Remove the default application menu bar (File/Edit/View/Window/Help). Most
  // modern Electron apps hide it — it looks out of place over a web UI and
  // steals vertical space. Done once at boot.
  Menu.setApplicationMenu(null);

  // 1) First-run setup: secrets + DB migration. Must precede server start so
  //    startup.ts finds an existing DB and skips its own npx prisma db push
  //    (which would fail in the packaged env — no npx available).
  try {
    runFirstRun(dataDir, dbUrl, app.getVersion());
  } catch (err) {
    fatalBootError(err);
    return;
  }

  // 2) Secrets are read from .env and passed explicitly to the next child in
  //    startNextServer (next start doesn't auto-load .env from userData).

  // 3) Pick a free port. Start above 5000 to avoid Windows' Hyper-V/WSL
  //    excluded port ranges (which often cover 2955-3354, including 3000).
  //    Picking 3000 on such a machine makes net.listen() in the probe appear
  //    to succeed but the real `next start` bind fails with EACCES, and the
  //    app exits silently.
  const port = await pickFreePort(8765);

  // 4) Spawn the Next.js server. cwd = resources/app/ so path.resolve() in the
  //    server code finds workers/ and .next/. Data paths come via env vars.
  bootedPort = port;
  bootedDataDir = dataDir;
  startNextServer(port, dataDir);

  // 5) Wait for readiness, then open the window.
  createTray(port);
  try {
    await waitForServer(port);
  } catch (err) {
    fatalBootError(err);
    return;
  }
  createWindow(port);

  // Kick off auto-update: a first check 30s after boot (give the user time to
  // land in the app), then every 12h while the app runs. Manual checks via the
  // About dialog IPC bypass this schedule. We don't block boot on the check.
  scheduleUpdateChecks();
}

// ─── auto-update checks + IPC ───────────────────────────────────────────────
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const UPDATE_FIRST_CHECK_DELAY_MS = 30_000; // 30s after boot
let updateCheckTimer: NodeJS.Timeout | null = null;

/** Start the periodic update-check loop. Safe to call once at boot. */
function scheduleUpdateChecks(): void {
  const check = () => {
    // Only auto-check when packaged — in dev (next dev / electron:dev) there is
    // no real release channel to consult and a 404 just clutters the logs.
    if (!app.isPackaged) return;
    void updater.checkForUpdates().catch(() => {
      /* surfaced via status; swallow to keep the timer alive */
    });
  };
  setTimeout(check, UPDATE_FIRST_CHECK_DELAY_MS);
  updateCheckTimer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Forward every update status change to the renderer (when a window exists).
 * Mounted at module load so it's active before the first check fires.
 */
updater.onStatus((status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("synthetix:update:progress", updater.publicStatus(status));
  }
});

// IPC: renderer reads the current status (e.g. when the About dialog opens).
// Strip the internal `verifiedAsset` before crossing the IPC boundary.
ipcMain.handle("synthetix:update:get-status", () => updater.publicStatus(updater.getStatus()));

// IPC: renderer triggers a manual check (About dialog "check now" / open).
// `checkForUpdates` stores an internal verifiedAsset for the downloader; strip
// it from the response exactly as the status push/get channels do.
ipcMain.handle("synthetix:update:check-now", async () =>
  updater.publicStatus(await updater.checkForUpdates())
);

// IPC: renderer triggers download + apply (the "立即更新" button).
ipcMain.handle("synthetix:update:download-and-install", async () =>
  updater.downloadAndInstall()
);

// ─── Next.js server child ───────────────────────────────────────────────────
function startNextServer(port: number, dataDir: string): void {
  const cwd = appRoot();
  const nodeExe = app.isPackaged ? bundledNodePath() : process.execPath;
  // standalone server.js — Next.js standalone output produces a self-contained
  // server.js that replaces `next start`. It reads PORT/HOSTNAME from env.
  const serverJs = path.join(appRoot(), "server.js");

  // CRITICAL: explicitly load the generated secrets from <userData>/.env and
  // inject them into the child env. The standalone server.js does not
  // auto-load .env, so without this the middleware (proxy.ts) throws
  // "FATAL: JWT_SECRET is required" on the first request and the server exits
  // with code 1. Relying on process.env inheritance through Electron's
  // main→child boundary is unreliable; pass them explicitly.
  const envFile = parseEnvFile(envFilePath());

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envFile, // secrets from .env OVERRIDE process.env (in case process.env has stale/empty values)
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: undefined as unknown as string, // ensure full node, not renderer
    HOSTNAME: HOST,
    PORT: String(port),
    NEXT_PUBLIC_APP_URL: `http://${HOST}:${port}`,
    NEXT_PUBLIC_APP_NAME: "Synthetix",
    DATABASE_URL: `file:${path.join(dataDir, "dev.db").replace(/\\/g, "/")}`,
    DB_PATH: dataDir,
    DATA_DIR: dataDir,
    DOCUMENT_ROOT: path.join(dataDir, "documents"),
    PYTHON_PATH: pythonPath(),
    PYTHON_DAEMON_ENABLED: "true",
    // Local embedding model for the chunking pipeline (local_chunk.py / daemon).
    // Ships as a dedicated resource at resources/app/models/gte-multilingual-base;
    // resolve relative to the bundled app root so it works regardless of cwd.
    LOCAL_EMBED_MODEL_PATH: path.join(appRoot(), "models", "gte-multilingual-base"),
  };

  // In dev (electron:dev), server.js doesn't exist yet — fall back to next CLI.
  const args = fs.existsSync(serverJs)
    ? [serverJs]
    : [nextCliPath(), "start", "-p", String(port), "-H", HOST];

  nextServer = spawn(nodeExe, args, {
    cwd,
    env,
    windowsHide: true, // no console window on Windows
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Log server output to a file in userData for support/debugging.
  const logPath = path.join(dataDir, "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  nextServer.stdout?.pipe(logStream);
  nextServer.stderr?.pipe(logStream);

  nextServer.on("exit", (code, signal) => {
    console.log(`[next] server exited (code=${code} signal=${signal})`);
    nextServer = null;
    if (!isQuitting) {
      // Unexpected exit — surface to the user and quit.
      dialog.showErrorBox(
        "Synthetix backend stopped",
        `The local server exited unexpectedly (code ${code}). See ${logPath}.`
      );
      app.quit();
    }
  });
}

// ─── window ─────────────────────────────────────────────────────────────────
function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false, // show on 'ready-to-show' to avoid white flash
    title: "Synthetix",
    autoHideMenuBar: true, // hide the menu bar (Alt toggles); pairs with setApplicationMenu(null)
    // Hide the system title bar and draw a Windows overlay instead, so the
    // title bar background matches the page (light/dark) rather than the OS
    // default. The min/max/close buttons remain (rendered by Windows). The
    // overlay color is updated from the renderer via IPC when the theme
    // changes (see handleThemeColor below); initial value = light bg #F8FAFC.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#F8FAFC", // matches --background (light) in globals.css
      symbolColor: "#334155", // slate-700, readable on light bg
      height: 40,
    },
    // Window icon: pass the path only if it exists (empty string would be
    // ignored by BrowserWindow, but be explicit).
    ...(trayIconPath() ? { icon: trayIconPath() } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://${HOST}:${port}`);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Close-to-tray instead of quitting, so the backend keeps running.
  mainWindow.on("close", (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── tray ───────────────────────────────────────────────────────────────────
function createTray(port: number): void {
  tray = new Tray(trayImage());
  tray.setToolTip("Synthetix");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open Synthetix",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow(port);
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow(port);
    }
  });
}

function trayIconPath(): string {
  // Resolve a real icon file for the tray/window. In a packaged build the
  // branded icon ships as a resource (extraResources: build/icon.ico →
  // resources/icon.ico). In dev it lives at build/icon.ico.
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
    path.join(appRoot(), "icon.ico"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "";
}

/**
 * Build a Tray image safely. `new Tray("")` throws "Failed to load image from
 * path" and crashes the app, so when no icon file is found we fall back to an
 * empty native image (Electron renders a default tray slot) instead of an
 * empty string.
 */
function trayImage() {
  const p = trayIconPath();
  if (p) return p;
  return nativeImage.createEmpty();
}

// ─── env file loader ────────────────────────────────────────────────────────
/**
 * Parse a .env file into a plain object (KEY → VALUE). No shell expansion.
 * Used to explicitly pass generated secrets to the next child, since next start
 * only auto-loads .env from its CWD (which has none in the packaged app).
 */
function parseEnvFile(envPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

// ─── error handling ─────────────────────────────────────────────────────────
function fatalBootError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  dialog.showErrorBox(
    "Synthetix failed to start",
    `Synthetix could not start its local backend:\n\n${msg}\n\nCheck the server log in:\n${path.join(
      userDataDir(),
      "server.log"
    )}`
  );
  app.quit();
}

// ─── shutdown ───────────────────────────────────────────────────────────────
app.on("before-quit", (e) => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (nextServer && !isQuitting) {
    e.preventDefault();
    isQuitting = true;
    gracefullyKill(nextServer, () => {
      nextServer = null;
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  // On all platforms we keep running in the tray; quit only via tray Quit.
  // (Override the default macOS-only behavior intentionally.)
});

/** Kill a child, escalating from SIGTERM to SIGKILL after a grace period. */
function gracefullyKill(child: ChildProcess, done: () => void): void {
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      done();
    }
  };
  child.once("exit", finish);

  // Windows has no SIGTERM semantics; taskkill the process tree.
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
    } catch {
      /* ignore */
    }
    setTimeout(finish, 3000);
  } else {
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish();
    }, 5000);
  }
}
