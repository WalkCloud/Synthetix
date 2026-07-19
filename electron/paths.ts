/**
 * Path resolution for the packaged Electron app.
 *
 * Layout after electron-builder packaging:
 *   <install>/Synthetix.exe                        (Electron shell)
 *   <install>/resources/app/                       (the bundled Next.js app)
 *   <install>/resources/app/runtime/python/        (CPython runtime)
 *   <install>/resources/app/workers/python/        (RAG worker scripts)
 *   <install>/resources/app/.next/                 (built Next.js)
 *   <install>/resources/app/node_modules/          (hoisted prod deps)
 *   <install>/resources/app/prisma/migrations/     (DB migrations)
 *
 * User-writable data lives OUTSIDE the install dir (which may be read-only):
 *   <userData>/ = %APPDATA%/Synthetix on Windows
 *     dev.db            (SQLite database)
 *     documents/        (uploaded reference docs)
 *     rag/              (LightRAG knowledge graph / embeddings)
 *     tmp/              (conversion / export scratch)
 *     .env              (generated secrets)
 *
 * Critical: the Next.js server's process.cwd() MUST be resources/app/ because
 * four call sites resolve Python scripts and tmp dirs via path.resolve("...")
 * against cwd (src/lib/python-daemon.ts, converter.ts, export-pipeline.ts).
 * All data dirs are passed via env vars (DATABASE_URL, DB_PATH, DATA_DIR,
 * DOCUMENT_ROOT) which take precedence over cwd-relative defaults, so the
 * server writes data to userData even though it runs from resources/app.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";

/** The bundled Next.js app root. In production this is resources/app/. */
export function appRoot(): string {
  // process.resourcesPath points at <install>/resources/ in a packaged app.
  // In dev (electron:dev), fall back to the project root so workers/.next resolve.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.resolve(__dirname, "..");
}

/** User-writable data directory (%APPDATA%/Synthetix). */
export function userDataDir(): string {
  return app.getPath("userData");
}

/**
 * Path to the bundled CPython interpreter.
 *
 * python-build-standalone (used for both the macOS and Windows bundles) ships
 * its interpreter under `runtime/python/bin/{python3,python.exe}`, NOT flat at
 * `runtime/python/{python3,python.exe}`. The build scripts confirm this layout:
 *   - scripts/build-installer-mac.mjs copies the whole python-build-standalone
 *     tree, landing the binary at runtime/python/bin/python3.
 *   - scripts/build-electron-mac.mjs asserts runtime/python/bin/python3 exists.
 *
 * Resolve the canonical `bin/` location first, and only fall back to the flat
 * layout if a particular install happened to flatten it. This keeps the path
 * correct on both macOS and Windows without changing the build output.
 */
export function pythonPath(): string {
  const exe = process.platform === "win32" ? "python.exe" : "python3";
  const pyRoot = path.join(appRoot(), "runtime", "python");
  const binned = path.join(pyRoot, "bin", exe);
  const flat = path.join(pyRoot, exe);
  // Prefer the bin/ layout when it actually exists; fall back to flat for
  // legacy/flattened installs so we never hard-fail on a working binary.
  return fs.existsSync(binned) ? binned : flat;
}

/** Path to the Next.js CLI shipped in node_modules. */
export function nextCliPath(): string {
  return path.join(appRoot(), "node_modules", "next", "dist", "bin", "next");
}

/** Path to the bundled node executable (shipped in resources/app/runtime). */
export function bundledNodePath(): string {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const candidate = path.join(appRoot(), "runtime", exe);
  return candidate;
}

/** Path to the Prisma CLI shipped in node_modules (for first-run migrate). */
export function prismaCliPath(): string {
  return path.join(appRoot(), "node_modules", "prisma", "build", "index.js");
}

/** .env location inside userData. */
export function envFilePath(): string {
  return path.join(userDataDir(), ".env");
}

/** Path to the bundled first-run setup script (commonjs, runs under node). */
export function firstRunScriptPath(): string {
  return path.join(__dirname, "first-run.js");
}
