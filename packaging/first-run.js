// Bundled-app first-run setup. Idempotent.
//  1. Generates fresh JWT_SECRET / ENCRYPTION_KEY into .env if absent.
//  2. Applies Prisma migrations to create the SQLite DB if absent.
// Invoked by start.bat before launching the Next.js server. Uses the bundled
// node.exe (process.execPath), so no system Node is required.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const APP_DIR = __dirname;
const ENV_PATH = path.join(APP_DIR, ".env");
const DATA_DIR = process.env.DATA_DIR || path.join(APP_DIR, "data");

function randomSecret(len) {
  // base64url of random bytes, trimmed to len — URL/token safe.
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

// 1) Secrets — only on first run.
if (!fs.existsSync(ENV_PATH)) {
  const env = [
    `JWT_SECRET=${randomSecret(40)}`,
    `ENCRYPTION_KEY=${randomSecret(40)}`,
    `JWT_ACCESS_EXPIRES=15m`,
    `JWT_REFRESH_EXPIRES=7d`,
    `NEXT_PUBLIC_APP_NAME=Synthetix`,
    `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
    "",
  ].join("\n");
  fs.writeFileSync(ENV_PATH, env, "utf8");
  console.log("[first-run] generated .env with fresh secrets");
}

// 2) Database — create via migrations if the DB file is missing.
fs.mkdirSync(DATA_DIR, { recursive: true });
const dbFile = path.join(DATA_DIR, "dev.db");
if (!fs.existsSync(dbFile)) {
  console.log("[first-run] creating database (prisma migrate deploy)…");
  const prismaCli = path.join(APP_DIR, "node_modules", "prisma", "build", "index.js");
  const res = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: APP_DIR,
    env: process.env,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    console.error(`[first-run] prisma migrate deploy failed (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
  console.log("[first-run] database ready");
} else {
  console.log("[first-run] database exists, skipping migration");
}

console.log("[first-run] setup complete");
