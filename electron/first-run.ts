/**
 * First-run setup, ported from packaging/first-run.js.
 *
 * Runs BEFORE the Next.js server starts. Idempotent:
 *   1. Generates fresh JWT_SECRET / ENCRYPTION_KEY into <userData>/.env if absent.
 *   2. Applies Prisma migrations to create the SQLite DB if absent.
 *
 * Invoked from the Electron main process via the bundled node executable, so no
 * system Node is required. All paths target <userData> (writable) — never the
 * install dir.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { envFilePath, prismaCliPath, appRoot, bundledNodePath } from "./paths";

function randomSecret(len: number): string {
  // base64url of random bytes, trimmed to len — URL/token safe.
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

export interface FirstRunResult {
  /** True if .env had to be created this run (vs already existed). */
  createdEnv: boolean;
  /** True if the DB file had to be created via migrations this run. */
  createdDb: boolean;
}

/**
 * Run first-run setup. Throws on hard failure (prisma migrate exit != 0).
 * `dataDir` is the userData directory; `dbUrl` is the resolved file: URL.
 */
export function runFirstRun(dataDir: string, dbUrl: string): FirstRunResult {
  const envPath = envFilePath();

  fs.mkdirSync(dataDir, { recursive: true });

  // 1) Secrets — only on first run.
  let createdEnv = false;
  if (!fs.existsSync(envPath)) {
    const env = [
      `JWT_SECRET=${randomSecret(40)}`,
      `ENCRYPTION_KEY=${randomSecret(40)}`,
      `JWT_ACCESS_EXPIRES=15m`,
      `JWT_REFRESH_EXPIRES=7d`,
      `NEXT_PUBLIC_APP_NAME=Synthetix`,
      `DATABASE_URL=${dbUrl}`,
      "",
    ].join("\n");
    fs.writeFileSync(envPath, env, "utf8");
    createdEnv = true;
    console.log("[first-run] generated .env with fresh secrets");
  }

  // 2) Database — create via migrations if the DB file is missing.
  //    Derive the on-disk db path from the URL (file:<dir>/dev.db).
  const dbFile = dbUrl.replace(/^file:/, "").replace(/\//g, path.sep);
  let createdDb = false;
  if (!fs.existsSync(dbFile)) {
    console.log("[first-run] creating database (prisma migrate deploy)…");
    const cli = prismaCliPath();
    // IMPORTANT: use the bundled node.exe, NOT process.execPath. In a packaged
    // Electron app, process.execPath is Synthetix.exe — spawning it to run a
    // node script would launch ANOTHER Electron GUI instance (or hang), not
    // run prisma. The bundled runtime/node.exe runs it correctly as node.
    const nodeExe = bundledNodePath();
    const res = spawnSync(nodeExe, [cli, "migrate", "deploy"], {
      cwd: appRoot(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "inherit",
    });
    if (res.status !== 0) {
      throw new Error(`prisma migrate deploy failed (exit ${res.status})`);
    }
    createdDb = true;
    console.log("[first-run] database ready");
  } else {
    console.log("[first-run] database exists, skipping migration");
  }

  console.log("[first-run] setup complete");
  return { createdEnv, createdDb };
}
