/**
 * First-run setup, ported from packaging/first-run.js.
 *
 * Runs BEFORE the Next.js server starts. Idempotent:
 *   1. Generates fresh JWT_SECRET / ENCRYPTION_KEY into <userData>/.env if absent.
 *   2. Applies Prisma migrations to create the SQLite DB if absent.
 *
 * Database creation uses better-sqlite3 to execute migration.sql files
 * directly (no prisma CLI needed). This runs in a CHILD PROCESS using the
 * bundled node.exe — NOT in the Electron main process — because
 * better-sqlite3 is a native module compiled for Node's ABI, not Electron's.
 * Requiring it from Electron's main would throw MODULE_NOT_FOUND or crash.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { envFilePath, appRoot, bundledNodePath } from "./paths";

function randomSecret(len: number): string {
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

export interface FirstRunResult {
  createdEnv: boolean;
  createdDb: boolean;
}

/** The inline script that runs in a child process (bundled node.exe) to
 *  create the database via better-sqlite3. Executed as `node -e "..."`. */
function buildMigrateScript(dbPath: string, migrationsDir: string): string {
  // The script is a self-contained IIFE that:
  // 1. Opens the SQLite DB via better-sqlite3
  // 2. Creates the _prisma_migrations tracking table
  // 3. Reads and executes each migration.sql in order
  // 4. Records each as applied
  return `
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dbPath = ${JSON.stringify(dbPath)};
const migrationsDir = ${JSON.stringify(migrationsDir)};

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(\`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  );
\`);

const migrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

for (const migrationName of migrations) {
  const sqlFile = path.join(migrationsDir, migrationName, "migration.sql");
  if (!fs.existsSync(sqlFile)) continue;
  const applied = db.prepare("SELECT 1 FROM _prisma_migrations WHERE migration_name = ?").get(migrationName);
  if (applied) continue;
  console.log("[migrate] applying: " + migrationName);
  const sql = fs.readFileSync(sqlFile, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  db.exec(sql);
  db.prepare("INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)")
    .run(crypto.randomUUID(), checksum, migrationName);
}
db.close();
console.log("[migrate] done, " + migrations.length + " migrations processed");
`;
}

/**
 * Run first-run setup and/or schema migration.
 *
 * `currentVersion` is the app version this run is booting (from app.getVersion()).
 * It is only used to name DB backups, never for migration gating — migrations
 * ALWAYS run, which is safe because buildMigrateScript is idempotent (it skips
 * rows already present in _prisma_migrations). The previous version of this
 * function skipped migration when the DB existed, which silently broke upgrades:
 * a new version ships new migrations, but an existing DB caused them to be
 * skipped, leaving the service to connect to a stale schema.
 */
export function runFirstRun(dataDir: string, dbUrl: string, currentVersion: string): FirstRunResult {
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

  // 2) Database — create via better-sqlite3 in a child process.
  //    We spawn the bundled node.exe (not Electron's process.execPath) because
  //    better-sqlite3 is compiled for Node's ABI, not Electron's.
  const dbFile = dbUrl.replace(/^file:/, "").replace(/\//g, path.sep);
  const dbExists = fs.existsSync(dbFile);

  // 3) Back up an existing DB before migrating, so a failed/aborted migration
  //    can be rolled back. Named with the CURRENT version (the version that
  //    last ran successfully against this DB). Keep exactly one backup per
  //    version; a repeated boot of the same version reuses it.
  const bakPath = path.join(dataDir, `dev.db.bak-${currentVersion}`);
  let rolledBackupPath: string | null = null;
  if (dbExists && !fs.existsSync(bakPath)) {
    try {
      fs.copyFileSync(dbFile, bakPath);
      rolledBackupPath = bakPath;
      console.log(`[first-run] backed up DB → ${path.basename(bakPath)}`);
    } catch (err) {
      // A failed backup is non-fatal: log and proceed. The migration itself
      // is still safer to run than to skip (skipping means a guaranteed stale
      // schema). We just lose the rollback safety net for this boot.
      console.warn(`[first-run] DB backup failed (non-fatal): ${String(err)}`);
    }
  }

  // 4) ALWAYS run migrations. Idempotent: buildMigrateScript creates the
  //    _prisma_migrations tracking table and skips already-applied rows, so a
  //    fresh DB applies all migrations and an existing DB applies only new ones.
  //    This is the upgrade-safe path — the previous "skip if exists" branch was
  //    the schema-drift bug.
  if (dbExists) {
    console.log("[first-run] DB exists; applying pending migrations (idempotent)…");
  } else {
    console.log("[first-run] creating database (better-sqlite3 migrations)…");
  }
  const migrationsDir = path.join(appRoot(), "prisma", "migrations");
  const script = buildMigrateScript(dbFile, migrationsDir);
  const nodeExe = bundledNodePath();
  const res = spawnSync(nodeExe, ["-e", script], {
    cwd: appRoot(),
    env: { ...process.env },
    stdio: "inherit",
  });
  if (res.status !== 0) {
    // Migration failed. Restore from the backup we just took (if any) so the
    // DB is left at its last-known-good state, then surface the error. A
    // partial DB (no backup available, e.g. first-ever creation) is removed so
    // the next boot can retry cleanly.
    if (rolledBackupPath && fs.existsSync(rolledBackupPath)) {
      try {
        fs.copyFileSync(rolledBackupPath, dbFile);
        console.log("[first-run] restored DB from backup after migration failure");
      } catch (restoreErr) {
        console.error(`[first-run] DB restore failed: ${String(restoreErr)}`);
      }
    } else {
      try { fs.unlinkSync(dbFile); } catch { /* ignore */ }
    }
    throw new Error(`database migration failed (node exit ${res.status})`);
  }

  console.log("[first-run] setup complete");
  return { createdEnv, createdDb: !dbExists };
}
