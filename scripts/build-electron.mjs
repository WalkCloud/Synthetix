#!/usr/bin/env node
/**
 * Synthetix Electron Windows installer — one-shot build script.
 *
 * Produces a distributable Synthetix-Setup-v<ver>.exe by:
 *   1. Asserting .next is built (run `pnpm build` first if not).
 *   2. Asserting dist/app/ exists (run `node scripts/build-installer.mjs
 *      --assemble-only --no-build` after preparing dist/runtime — bundles
 *      node.exe + CPython + .next + node_modules).
 *   3. Compiling electron/*.ts → dist/electron-main/*.js.
 *   4. Running electron-builder (--win nsis) → dist/electron/*.exe.
 *
 * This reuses the existing dist/app/ bundle verbatim as extraResources; the
 * Electron main process spawns `next start` against it. No standalone migration.
 *
 * Usage:  node scripts/build-electron.mjs [--no-compile]
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

export function buildElectronBuilderEnv(env = process.env) {
  const builderEnv = { ...env };
  if (env.WINDOWS_CERT_PATH) {
    builderEnv.CSC_LINK = env.WINDOWS_CERT_PATH;
    if (env.WINDOWS_CERT_PASSWORD !== undefined) {
      builderEnv.CSC_KEY_PASSWORD = env.WINDOWS_CERT_PASSWORD;
    }
  }
  return builderEnv;
}

export function signingStatusMessage(env = process.env) {
  return env.WINDOWS_CERT_PATH || env.CSC_LINK
    ? "Authenticode signing enabled for this Windows build."
    : "No Windows code-signing certificate provided — building unsigned (SmartScreen will warn).";
}

export function resolveBundledPythonPath(appBundle = APP_BUNDLE) {
  const candidates = [
    path.join(appBundle, "runtime", "python", "bin", "python.exe"),
    path.join(appBundle, "runtime", "python", "python.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// ---------- helpers ----------
function log(...m) {
  console.log(`\n\x1b[36m[build-electron]\x1b[0m`, ...m);
}
function warn(...m) {
  console.error(`\x1b[33m[build-electron:WARN]\x1b[0m`, ...m);
}
function fail(...m) {
  console.error(`\x1b[31m[build-electron:ERROR]\x1b[0m`, ...m);
  process.exit(1);
}

/** Run a command, inherit stdio, fail on non-zero exit. */
function run(cmd, cmdArgs, opts = {}) {
  const display = `${cmd} ${cmdArgs.join(" ")}`;
  log(`$ ${display}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: true, ...opts });
  if (res.status !== 0) {
    fail(`command failed (exit ${res.status}): ${display}`);
  }
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.version;
}

// ---------- main ----------
function main() {
  const t0 = Date.now();
  const VERSION = readVersion();
  const builderEnv = buildElectronBuilderEnv();
  log(`building Synthetix Electron installer v${VERSION}`);
  if (builderEnv.CSC_LINK) {
    log(signingStatusMessage(builderEnv));
  } else {
    warn(signingStatusMessage(builderEnv));
  }

  // 1) Assert .next is built.
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    fail(
      `.next is not built. Run \`pnpm build\` first, then re-run this script.`
    );
  }
  log("✓ .next is built");

  // 2) Assert dist/app/ exists with the expected runtime pieces.
  // NOTE: the entry point is standalone server.js (not the `next` CLI — that's
  // only a dev fallback in main.ts when server.js is absent). Standalone tracing
  // does not ship node_modules/next/dist/bin/next, so don't assert it.
  const checks = [
    APP_BUNDLE,
    path.join(APP_BUNDLE, ".next"),
    path.join(APP_BUNDLE, "server.js"),
    path.join(APP_BUNDLE, "runtime", "node.exe"),
    path.join(APP_BUNDLE, "workers", "python", "daemon.py"),
    path.join(APP_BUNDLE, "node_modules", "prisma"),
    path.join(APP_BUNDLE, "prisma", "migrations"),
  ];
  for (const c of checks) {
    if (!fs.existsSync(c)) {
      fail(
        `dist/app is not ready (missing ${path.relative(ROOT, c)}).\n` +
          `Run \`node scripts/build-installer.mjs --assemble-only --no-build\` after preparing dist/runtime, ` +
          `then re-run this script.`
      );
    }
  }
  const bundledPython = resolveBundledPythonPath();
  if (!bundledPython) {
    fail(
      "dist/app is not ready (missing runtime/python/bin/python.exe or runtime/python/python.exe).\n" +
        "Run `node scripts/build-installer.mjs --assemble-only --no-build` after preparing dist/runtime, " +
        "then re-run this script."
    );
  }
  log("✓ dist/app bundle is ready (node + python + .next + workers)");

  // 3) Compile electron TS → dist/electron-main.
  if (!SKIP_COMPILE) {
    log("compiling electron main process (tsc)…");
    const tsconfig = path.join(ROOT, "electron", "tsconfig.json");
    run("npx", ["tsc", "-p", tsconfig], { cwd: ROOT });
    // tsc emits under dist/electron-main per electron/tsconfig outDir.
    const mainJs = path.join(ELECTRON_OUT, "main.js");
    if (!fs.existsSync(mainJs)) {
      fail(`tsc did not emit ${path.relative(ROOT, mainJs)}`);
    }
    log("✓ electron main compiled");
  } else {
    log("(skipped TS compile via --no-compile)");
  }

  // 4) Run electron-builder (--win nsis).
  //    Two-phase: (a) pack the app into win-unpacked, (b) build the NSIS
  //    installer FROM that unpacked dir via --prepackaged. Splitting lets each
  //    phase fit comfortably under CI/shell timeouts, and (b) alone can be
  //    re-run quickly after an electron-main-only change (the 1.4GB bundle in
  //    win-unpacked is not rebuilt).
  const unpackedDir = path.join(DIST, "electron", "win-unpacked");
  const hasUnpacked = fs.existsSync(path.join(unpackedDir, "Synthetix.exe"));

  // Guard against the v1.0.3 regression: a version bump + source change that
  // does NOT invalidate win-unpacked would silently get packaged with the old
  // app.asar (e.g. installer named 1.0.3 but app reports 1.0.1). Before reusing
  // the unpacked dir, verify the asar's baked version matches package.json; if
  // not, delete it and fall through to the full rebuild. This is a no-op when
  // the asar reader isn't installed (transitive dep missing in minimal trees).
  let reusedUnpacked = hasUnpacked;
  if (hasUnpacked) {
    if (!isAsarReaderAvailable()) {
      warn(
        "win-unpacked exists but @electron/asar not installed — cannot verify " +
          "its version. Assuming fresh; delete dist/electron/win-unpacked if " +
          "the build produces a wrong-version app."
      );
    } else {
      const asarVer = asarVersionOrNull(unpackedDir);
      if (asarVer !== null && asarVer !== VERSION) {
        warn(
          `win-unpacked is STALE (app.asar version ${asarVer} ≠ ${VERSION}); ` +
            "deleting it and rebuilding from scratch."
        );
        try {
          fs.rmSync(unpackedDir, { recursive: true, force: true });
        } catch (e) {
          fail(`could not delete stale win-unpacked: ${e.message}`);
        }
        reusedUnpacked = false;
      } else if (asarVer === null) {
        warn(
          "win-unpacked exists but app.asar version unreadable — proceeding; " +
            "delete dist/electron/win-unpacked if the build is wrong."
        );
      } else {
        log(`win-unpacked asar version ${asarVer} matches ${VERSION} — safe to reuse.`);
      }
    }
  }

  if (reusedUnpacked) {
    // win-unpacked exists — only (re)build the installer from it. This is the
    // fast path for main-process-only changes after a first full build.
    log("win-unpacked exists — building installer via --prepackaged (fast)…");
    run(
      "npx",
      [
        "electron-builder",
        "--win",
        "nsis",
        "--prepackaged",
        unpackedDir,
        "--config",
        "electron-builder.yml",
        // --publish never: electron-builder.yml declares `publish: github` so
        // electron-builder emits latest.yml alongside the installer, but we do
        // NOT want it to auto-upload. The actual release upload is handled by
        // publish-release.mjs (which also signs stable.json). Without this
        // flag, electron-builder sees CI=true + the publish config and tries
        // to upload, crashing with "GitHub Personal Access Token is not set"
        // (GH_TOKEN isn't injected here intentionally) and racing with
        // publish-release.mjs.
        "--publish",
        "never",
      ],
      { cwd: ROOT, env: builderEnv }
    );
  } else {
    // No win-unpacked yet — full pack + installer in one electron-builder run.
    log("no win-unpacked yet — full electron-builder run (--win)…");
    run(
      "npx",
      [
        "electron-builder",
        "--win",
        "--config",
        "electron-builder.yml",
        // See the --publish never rationale in the --prepackaged branch above.
        "--publish",
        "never",
      ],
      { cwd: ROOT, env: builderEnv }
    );
  }

  // 5) Report.
  const installerDir = path.join(DIST, "electron");
  const candidates = fs.existsSync(installerDir)
    ? fs.readdirSync(installerDir).filter((f) => f.endsWith(".exe"))
    : [];
  const installer = candidates.find((f) => f.includes(VERSION)) ?? candidates[0];
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  log("────────────────────────────────────────");
  if (installer) {
    const full = path.join(installerDir, installer);
    const mb = (fs.statSync(full).size / (1024 * 1024)).toFixed(1);
    log(`✓ built ${installer} (${mb} MB) in ${secs}s`);
    log(`  → ${full}`);
  } else {
    warn(`no .exe found in ${path.relative(ROOT, installerDir)} (took ${secs}s)`);
    warn(`  check electron-builder output above`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
