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
import { app, BrowserWindow, Tray, Menu, dialog } from "electron";
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

// ─── globals ────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nextServer: ChildProcess | null = null;
let isQuitting = false;

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

  // 1) First-run setup: secrets + DB migration. Must precede server start so
  //    startup.ts finds an existing DB and skips its own npx prisma db push
  //    (which would fail in the packaged env — no npx available).
  try {
    runFirstRun(dataDir, dbUrl);
  } catch (err) {
    fatalBootError(err);
    return;
  }

  // 2) Secrets are read from .env and passed explicitly to the next child in
  //    startNextServer (next start doesn't auto-load .env from userData).

  // 3) Pick a free port.
  const port = await pickFreePort(3000);

  // 4) Spawn the Next.js server. cwd = resources/app/ so path.resolve() in the
  //    server code finds workers/ and .next/. Data paths come via env vars.
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
}

// ─── Next.js server child ───────────────────────────────────────────────────
function startNextServer(port: number, dataDir: string): void {
  const cwd = appRoot();
  const nodeExe = app.isPackaged ? bundledNodePath() : process.execPath;
  const cli = nextCliPath();

  // CRITICAL: explicitly load the generated secrets from <userData>/.env and
  // inject them into the child env. `next start` auto-loads .env only from its
  // CWD (resources/app/), which has no .env — so without this, the middleware
  // (proxy.ts) throws "FATAL: JWT_SECRET is required" on the first request and
  // the server exits with code 1. Relying on process.env inheritance through
  // Electron's main→child boundary is unreliable; pass them explicitly.
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

  nextServer = spawn(nodeExe, [cli, "start", "-p", String(port), "-H", HOST], {
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
    icon: trayIconPath(),
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
  tray = new Tray(trayIconPath());
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
  // Prefer a dedicated tray icon if present.
  const candidates = [
    path.join(__dirname, "..", "build", "tray-icon.png"),
    path.join(process.resourcesPath || "", "tray-icon.png"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // No icon on disk — return empty string; Electron falls back to a default.
  return "";
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
