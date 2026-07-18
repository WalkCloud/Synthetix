#!/usr/bin/env node
/**
 * Synthetix Electron macOS DMG build — one-shot orchestrator.
 *
 * Produces dist/electron/Synthetix-<ver>-arm64.dmg by:
 *   1. Asserting .next is built.
 *   2. Asserting dist/app/ exists (run build-installer-mac.mjs first).
 *   3. Compiling electron/*.ts → dist/electron-main/*.js.
 *   4. Stale-checking mac-arm64/ (mirrors Windows win-unpacked guard).
 *   5. Running electron-builder (--mac dmg --arm64).
 *
 * Usage:  node scripts/build-electron-mac.mjs [--no-compile]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asarVersionOrNull, isAsarReaderAvailable } from "./lib/asar-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const DIST = path.join(ROOT, "dist");
const APP_BUNDLE = path.join(DIST, "app");
const ELECTRON_OUT = path.join(DIST, "electron-main");

const args = new Set(process.argv.slice(2));
const SKIP_COMPILE = args.has("--no-compile");

// ---------- platform guard ----------
if (process.platform !== "darwin") {
  fail(`build-electron-mac.mjs runs on macOS only (current: ${process.platform}). ` +
       `For Windows, use scripts/build-electron.mjs.`);
}
if (process.arch !== "arm64") {
  fail(`This script targets arm64 (current arch: ${process.arch}). Build on an Apple Silicon Mac.`);
}

// ---------- helpers ----------
function log(...m) { console.log(`\n\x1b[36m[build-electron-mac]\x1b[0m`, ...m); }
function warn(...m) { console.error(`\x1b[33m[build-electron-mac:WARN]\x1b[0m`, ...m); }
function fail(...m) { console.error(`\x1b[31m[build-electron-mac:ERROR]\x1b[0m`, ...m); process.exit(1); }

function run(cmd, cmdArgs, opts = {}) {
  const display = `${cmd} ${cmdArgs.join(" ")}`;
  log(`$ ${display}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: false, ...opts });
  if (res.status !== 0) fail(`command failed (exit ${res.status}): ${display}`);
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

// ---------- main ----------
function main() {
  const t0 = Date.now();
  const VERSION = readVersion();
  log(`building Synthetix macOS DMG v${VERSION}`);

  // 1) Assert .next is built.
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    fail(`.next is not built. Run \`npm run build\` first.`);
  }
  log("✓ .next is built");

  // 2) Assert dist/app/ exists with the expected runtime pieces.
  const checks = [
    APP_BUNDLE,
    path.join(APP_BUNDLE, ".next"),
    path.join(APP_BUNDLE, "server.js"),
    path.join(APP_BUNDLE, "runtime", "node"),
    path.join(APP_BUNDLE, "runtime", "python", "bin", "python3"),
    path.join(APP_BUNDLE, "workers", "python", "daemon.py"),
    path.join(APP_BUNDLE, "prisma", "migrations"),
  ];
  for (const c of checks) {
    if (!fs.existsSync(c)) {
      fail(`dist/app is not ready (missing ${path.relative(ROOT, c)}).\n` +
           `Run \`node scripts/build-installer-mac.mjs\` first.`);
    }
  }
  log("✓ dist/app bundle is ready (node + python3 + .next + workers)");

  // 3) Compile electron TS → dist/electron-main.
  if (!SKIP_COMPILE) {
    log("compiling electron main process (tsc)…");
    run("npx", ["tsc", "-p", path.join(ROOT, "electron", "tsconfig.json")], { cwd: ROOT });
    if (!fs.existsSync(path.join(ELECTRON_OUT, "main.js"))) {
      fail(`tsc did not emit ${path.relative(ROOT, path.join(ELECTRON_OUT, "main.js"))}`);
    }
    log("✓ electron main compiled");
  } else {
    log("(skipped TS compile via --no-compile)");
  }

  // 4) Stale-check mac-arm64/ (mirrors Windows win-unpacked guard). The .app
  //    bundles app.asar at Contents/Resources/app.asar; its baked version must
  //    match package.json or we rebuild from scratch.
  const unpackedDir = path.join(DIST, "electron", "mac-arm64");
  const appBundlePath = path.join(unpackedDir, "Synthetix.app");
  const asarPath = path.join(appBundlePath, "Contents", "Resources", "app.asar");
  const hasUnpacked = fs.existsSync(asarPath);
  let reusedUnpacked = hasUnpacked;
  if (hasUnpacked) {
    if (!isAsarReaderAvailable()) {
      warn("mac-arm64 exists but @electron/asar not installed — cannot verify version; " +
           "delete dist/electron/mac-arm64 if the build is wrong.");
    } else {
      const asarVer = asarVersionOrNull(asarPath);
      if (asarVer !== null && asarVer !== VERSION) {
        warn(`mac-arm64 is STALE (app.asar version ${asarVer} ≠ ${VERSION}); rebuilding.`);
        try { fs.rmSync(unpackedDir, { recursive: true, force: true }); } catch (e) { fail(`could not delete stale mac-arm64: ${e.message}`); }
        reusedUnpacked = false;
      } else if (asarVer === VERSION) {
        log(`mac-arm64 asar version ${asarVer} matches — safe to reuse.`);
      } else {
        warn("mac-arm64 app.asar version unreadable — proceeding; delete dist/electron/mac-arm64 if the build is wrong.");
      }
    }
  }

  // 5) Run electron-builder. A single run produces the unpacked .app + the .dmg.
  //    (--prepackaged is not used: electron-builder's mac DMG flow doesn't
  //    support the two-phase split the same way NSIS does.)
  if (reusedUnpacked) {
    log("mac-arm64 exists — re-running electron-builder to refresh the DMG…");
  } else {
    log("running electron-builder --mac dmg --arm64…");
  }
  run("npx", ["electron-builder", "--mac", "dmg", "--arm64", "--config", "electron-builder.yml"], { cwd: ROOT });

  // 6) Report.
  const installerDir = path.join(DIST, "electron");
  const candidates = fs.existsSync(installerDir)
    ? fs.readdirSync(installerDir).filter((f) => f.endsWith(".dmg"))
    : [];
  const installer = candidates.find((f) => f.includes(VERSION) && f.includes("arm64")) ?? candidates[0];
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log("────────────────────────────────────────");
  if (installer) {
    const full = path.join(installerDir, installer);
    const mb = (fs.statSync(full).size / (1024 * 1024)).toFixed(1);
    log(`✓ built ${installer} (${mb} MB) in ${secs}s`);
    log(`  → ${full}`);
    log(`  Gatekeeper: unsigned — users run \`xattr -dr com.apple.quarantine /Applications/Synthetix.app\` on first launch (see spec §2.5)`);
  } else {
    warn(`no .dmg found in ${path.relative(ROOT, installerDir)} (took ${secs}s)`);
  }
}

main();
