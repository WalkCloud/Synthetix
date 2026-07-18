#!/usr/bin/env node
/**
 * Synthetix macOS bundle assembler — produces dist/app/ for the mac electron
 * build. Mirrors scripts/build-installer.mjs (Windows) but swaps in:
 *   - darwin-arm64 node (downloaded from nodejs.org)
 *   - python-build-standalone (install_only variant, ~24MB)
 *   - the GTE embedding model (copied from data/models/ — operator-provided)
 * and skips the Windows-only .bat launchers + Inno Setup.
 *
 * The shared .next / node_modules / prisma / workers / public / legal assembly
 * comes from scripts/lib/bundle-assembly.mjs (same code path as Windows).
 *
 * Usage:  node scripts/build-installer-mac.mjs [--no-build]
 *
 * Run on macOS only (platform guard below). After this, run
 * scripts/build-electron-mac.mjs to wrap dist/app in a DMG.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  rmrf,
  dirSize,
  human,
  copyFile,
  copyDir,
  copyRootConfigs,
  copyStandalone,
  flattenPnpmStore,
  copyStaticAssets,
  generateLegalArtifacts,
} from "./lib/bundle-assembly.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const DIST = path.join(ROOT, "dist");
const APP = path.join(DIST, "app");

// --- pinned versions (bump explicitly; never as a range) ---
// Node major 20 matches engines.node (>=20) and the Windows CI node-version: 20.
const NODE_VERSION = "v20.20.2";
// python-build-standalone: install_only variant (smaller, no test ext, ships
// python/bin/python3). aarch64-apple-darwin = Apple Silicon.
const PYTHON_BS_TAG = "20260623";
const PYTHON_BS_ASSET = "cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz";
// Model: operator places it here (gitignored data/). Not downloaded by this script.
const MODEL_SRC = path.join(ROOT, "data", "models", "gte-multilingual-base");

const args = new Set(process.argv.slice(2));
const SKIP_BUILD = args.has("--no-build");

// ---------- platform guard ----------
if (process.platform !== "darwin") {
  fail(`build-installer-mac.mjs runs on macOS only (current: ${process.platform}). ` +
       `For Windows, use scripts/build-installer.mjs.`);
}
if (process.arch !== "arm64") {
  fail(`This script targets arm64 (current arch: ${process.arch}). ` +
       `Build on an Apple Silicon Mac.`);
}

// ---------- helpers ----------
function log(...m) { console.log(`\n\x1b[36m[build-installer-mac]\x1b[0m`, ...m); }
function warn(...m) { console.error(`\x1b[33m[build-installer-mac:WARN]\x1b[0m`, ...m); }
function fail(...m) { console.error(`\x1b[31m[build-installer-mac:ERROR]\x1b[0m`, ...m); process.exit(1); }

function run(cmd, cmdArgs, opts = {}) {
  const display = `${cmd} ${cmdArgs.join(" ")}`;
  log(`$ ${display}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: false, ...opts });
  if (res.status !== 0) fail(`command failed (exit ${res.status}): ${display}`);
}

/** Download a URL into a local path. Returns true on success. */
function download(url, destPath) {
  // curl ships on macOS; -fL fails on HTTP errors and follows redirects
  // (GitHub releases redirect to a CDN).
  const res = spawnSync("curl", ["-fL", "--retry", "3", "-o", destPath, url], {
    stdio: "inherit",
  });
  return res.status === 0;
}

/** Acquire darwin-arm64 node, cached at dist/.runtime-cache-darwin/node. */
function acquireNode() {
  const cacheDir = path.join(DIST, ".runtime-cache-darwin");
  const cachedNode = path.join(cacheDir, "node");
  if (fs.existsSync(cachedNode)) {
    log(`reusing cached node ${NODE_VERSION} (${path.relative(ROOT, cachedNode)})`);
    return cachedNode;
  }
  const url = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz`;
  const tgz = path.join(os.tmpdir(), `node-${NODE_VERSION}-darwin-arm64.tar.gz`);
  log(`downloading ${url}`);
  if (!download(url, tgz)) fail(`node download failed: ${url}`);
  // Extract into a temp dir, then lift bin/node into the cache.
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-extract-"));
  run("tar", ["-xzf", tgz, "-C", extractDir]);
  const extractedNode = path.join(extractDir, `node-${NODE_VERSION}-darwin-arm64`, "bin", "node");
  if (!fs.existsSync(extractedNode)) fail(`extracted node binary not found at ${extractedNode}`);
  rmrf(cacheDir, warn, ROOT);
  fs.mkdirSync(cacheDir, { recursive: true });
  copyFile(extractedNode, cachedNode);
  fs.chmodSync(cachedNode, 0o755);
  rmrf(extractDir, warn, ROOT);
  fs.rmSync(tgz, { force: true });
  // Sanity: the binary runs and reports the pinned version.
  const ver = spawnSync(cachedNode, ["--version"], { encoding: "utf8" }).stdout?.trim();
  if (ver !== NODE_VERSION) fail(`node version mismatch: got ${ver}, expected ${NODE_VERSION}`);
  log(`✓ node ${ver} cached`);
  return cachedNode;
}

/** Acquire python-build-standalone install_only, cached at dist/.runtime-cache-darwin/python/.
 *  Also installs the project's pip deps (workers/python/requirements.txt) so the
 *  bundled python can run the RAG/chunking workers (onnxruntime, transformers,
 *  docling, lightrag-hku, pypdfium2, etc.). The Windows build ships an operator-
 *  pre-installed full CPython env; this mirrors that by pip-installing into the
 *  relocatable standalone python's site-packages at build time. */
function acquirePython() {
  const cacheDir = path.join(DIST, ".runtime-cache-darwin", "python");
  const cachedPy3 = path.join(cacheDir, "bin", "python3");
  // Marker file written after deps are installed, so a cache hit means a
  // fully-prepared python (deps + all), not a bare one.
  const depsMarker = path.join(cacheDir, ".synthetix-deps-installed");
  if (fs.existsSync(cachedPy3) && fs.existsSync(depsMarker)) {
    log(`reusing cached python-build-standalone + deps (${path.relative(ROOT, cacheDir)})`);
    return cacheDir;
  }
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BS_TAG}/${encodeURIComponent(PYTHON_BS_ASSET)}`;
  const tgz = path.join(os.tmpdir(), PYTHON_BS_ASSET);
  if (!fs.existsSync(cachedPy3)) {
    log(`downloading ${url}`);
    if (!download(url, tgz)) fail(`python-build-standalone download failed: ${url}`);
    // The install_only tarball extracts to a single "python/" directory.
    const extractParent = fs.mkdtempSync(path.join(os.tmpdir(), "pybs-extract-"));
    run("tar", ["-xzf", tgz, "-C", extractParent]);
    const extractedPython = path.join(extractParent, "python");
    if (!fs.existsSync(path.join(extractedPython, "bin", "python3"))) {
      fail(`extracted python3 not found at ${extractedPython}/bin/python3`);
    }
    rmrf(cacheDir, warn, ROOT);
    fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
    // Rename extracted "python" → cacheDir so the cache path is .../python/
    fs.renameSync(extractedPython, cacheDir);
    rmrf(extractParent, warn, ROOT);
    fs.rmSync(tgz, { force: true });
    const ver = spawnSync(cachedPy3, ["--version"], { encoding: "utf8" }).stdout?.trim();
    if (!/Python 3\.12/.test(ver || "")) fail(`python version unexpected: ${ver}`);
    log(`✓ python-build-standalone cached (${ver})`);
  } else {
    log(`python cached but deps marker missing — reinstalling deps…`);
  }
  // Install the project's pip dependencies into the standalone python's
  // site-packages. The standalone python's pip is relocatable-aware (no
  // --target needed; it installs into its own lib/pythonX.Y/site-packages).
  // Pin to a known-good PyPI index; use the operator's pip config if set.
  const reqFile = path.join(ROOT, "workers", "python", "requirements.txt");
  if (!fs.existsSync(reqFile)) fail(`workers/python/requirements.txt not found at ${reqFile}`);
  log(`pip installing workers/python/requirements.txt into standalone python …`);
  // --proxy "" explicitly disables proxy detection. On macOS, pip otherwise
  // inherits the system network proxy (scutil --proxy), which is often a stale
  // VPN-client setting (127.0.0.1:port) left behind after the client exits —
  // breaking all downloads with "Connection refused". The empty string forces
  // a direct connection. PIP_INDEX_URL can still override the PyPI mirror.
  const pipArgs = ["-m", "pip", "install", "-r", reqFile,
                   "--proxy", "",
                   "--no-warn-script-location", "--progress-bar", "off"];
  if (process.env.PIP_INDEX_URL) {
    pipArgs.push("-i", process.env.PIP_INDEX_URL);
    log(`  using PyPI mirror: ${process.env.PIP_INDEX_URL}`);
  }
  // Explicitly null out proxy env vars for the pip subprocess. On macOS, pip's
  // requests/urllib3 inherit the system network proxy (scutil --proxy), which
  // is frequently a stale VPN-client setting (127.0.0.1:<port>) left behind
  // after the client exits — breaking all downloads with "Connection refused".
  // `--proxy ""` alone is insufficient; the empty env vars are the reliable
  // override. NO_PROXY="*" is belt-and-suspenders.
  const pipEnv = {
    ...process.env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "*",
  };
  const pipRes = spawnSync(cachedPy3, pipArgs, { stdio: "inherit", cwd: cacheDir, env: pipEnv });
  if (pipRes.status !== 0) fail(`pip install of requirements.txt failed (exit ${pipRes.status})`);
  // Verify onnxruntime actually imported (it's the load-bearing dep for RAG).
  const verifyRes = spawnSync(
    cachedPy3, ["-c", "import onnxruntime, transformers; print('deps OK')"],
    { encoding: "utf8" }
  );
  if (verifyRes.status !== 0 || !/deps OK/.test(verifyRes.stdout || "")) {
    fail(`post-install verification failed: onnxruntime/transformers not importable.\n` +
         `stderr: ${(verifyRes.stderr || "").slice(0, 300)}`);
  }
  fs.writeFileSync(depsMarker, new Date().toISOString(), "utf8");
  log(`✓ python deps installed + verified (onnxruntime, transformers)`);
  return cacheDir;
}

/**
 * Rebuild native node modules in the bundle against the bundled node's ABI.
 *
 * Why: the .node files copied from the dev machine's node_modules were
 * compiled for the dev node's NODE_MODULE_VERSION (e.g. 137 for node v24).
 * The bundle ships node v20 (NODE_MODULE_VERSION 115), so loading them
 * throws ERR_DLOPEN_FAILED. We rebuild only the version-specific (non-N-API)
 * modules against the bundled node so they match.
 *
 * Approach: rebuild in the ROOT node_modules (which has full source +
 * binding.gyp + build deps) using the bundled node + node-gyp, targeting
 * the bundled node's version, then copy the resulting .node into EVERY
 * location it appears in dist/app (standalone tracing can place it under
 * both node_modules/<pkg>/ and .next/node_modules/<pkg>-<hash>/).
 *
 * N-API modules (sharp via @img/sharp-*, @node-rs/*) are ABI-stable across
 * node versions and do NOT need rebuilding — verified at build time.
 */
function rebuildNativeModulesForBundledNode(appDir) {
  log("Step 3b: rebuild native node modules for bundled node ABI");
  const bundledNode = path.join(appDir, "runtime", "node");
  if (!fs.existsSync(bundledNode)) fail(`bundled node not found at ${bundledNode}`);
  const bundledVer = spawnSync(bundledNode, ["--version"], { encoding: "utf8" }).stdout?.trim();
  log(`  bundled node: ${bundledVer}`);

  // Modules that bind to a specific node ABI (NAN-based) and must be rebuilt.
  // N-API modules are excluded (they're ABI-stable). Add to this list if a
  // future dep introduces another NAN-based native module.
  const MODULES_TO_REBUILD = [
    { pkg: "better-sqlite3", nodeGlob: "better_sqlite3.node" },
  ];

  const nodeGyp = path.join(ROOT, "node_modules", ".bin", "node-gyp");
  if (!fs.existsSync(nodeGyp)) {
    fail(`node-gyp not found at ${nodeGyp}. Run \`npm install\` in the project root first.`);
  }

  for (const { pkg, nodeGlob } of MODULES_TO_REBUILD) {
    const pkgDir = path.join(ROOT, "node_modules", pkg);
    if (!fs.existsSync(path.join(pkgDir, "binding.gyp"))) {
      warn(`  ${pkg}: no binding.gyp in ${pkgDir} — skipping rebuild (may fail at runtime)`);
      continue;
    }
    log(`  rebuilding ${pkg} for ${bundledVer}…`);
    // node-gyp rebuild with the bundled node driving it, targeting the bundled
    // node's version. --arch=arm64 --platform=darwin match our target.
    const res = spawnSync(bundledNode, [nodeGyp, "rebuild",
      `--target=${bundledVer}`, "--runtime=node",
      "--arch=arm64", "--platform=darwin",
    ], { cwd: pkgDir, stdio: "inherit" });
    if (res.status !== 0) fail(`${pkg} rebuild failed (exit ${res.status})`);

    // The rebuilt .node is at node_modules/<pkg>/build/Release/<nodeGlob>.
    // Copy it to EVERY location it appears in dist/app (standalone tracing
    // may have placed copies under .next/node_modules/<pkg>-<hash>/ too).
    const rebuiltNode = path.join(pkgDir, "build", "Release", nodeGlob);
    if (!fs.existsSync(rebuiltNode)) fail(`rebuilt ${nodeGlob} not found at ${rebuiltNode}`);

    // Find all occurrences in the bundle and overwrite them.
    let replaced = 0;
    const findAndReplace = (dir) => {
      if (!fs.existsSync(dir)) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === ".pnpm" || e.name === ".cache") continue;
          findAndReplace(full);
        } else if (e.name === nodeGlob && full !== rebuiltNode) {
          fs.copyFileSync(rebuiltNode, full);
          replaced++;
        }
      }
    };
    findAndReplace(appDir);
    log(`  ✓ ${pkg}: rebuilt for ${bundledVer}, replaced ${replaced} copy(ies) in bundle`);
  }
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  log(`assembling Synthetix macOS bundle v${pkg.version} (dist/app)`);

  // Step 1: build .next
  if (!SKIP_BUILD) {
    log("Step 1: next build");
    run("npm", ["run", "build"], { cwd: ROOT });
  } else {
    warn("skipping build (--no-build)");
    if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")))
      fail(".next/BUILD_ID missing — run without --no-build first.");
  }

  // Step 2: assemble dist/app (shared, OS-agnostic portion via lib)
  log("Step 2: assemble dist/app (shared portion)");
  rmrf(APP, warn, ROOT);
  fs.mkdirSync(APP, { recursive: true });
  copyRootConfigs(ROOT, APP, warn);

  const standaloneDir = path.join(ROOT, ".next", "standalone");
  if (!fs.existsSync(path.join(standaloneDir, "server.js")))
    fail("standalone output missing — ensure output: 'standalone' in next.config.ts");
  try {
    copyStandalone(standaloneDir, APP, log);
  } catch (e) {
    fail(e.message);
  }
  flattenPnpmStore(APP, log, warn);
  copyStaticAssets(ROOT, APP, log);
  await generateLegalArtifacts(APP, ROOT, pkg.license || "UNLICENSED", log, warn);

  // Step 3: runtime (macOS-specific)
  log("Step 3: acquire runtime (darwin-arm64 node + python-build-standalone)");
  fs.mkdirSync(path.join(APP, "runtime"), { recursive: true });
  const nodeSrc = acquireNode();
  copyFile(nodeSrc, path.join(APP, "runtime", "node"));
  fs.chmodSync(path.join(APP, "runtime", "node"), 0o755);
  const pySrc = acquirePython();
  // python-build-standalone ships python/bin/python3 + python/lib/...; copy the
  // whole dir to runtime/python/ so paths.ts pythonPath()
  // (appRoot/runtime/python/python3) resolves.
  copyDir(pySrc, path.join(APP, "runtime", "python"));
  // Ensure python3 is executable after copy (copyDir may not preserve mode).
  const py3 = path.join(APP, "runtime", "python", "bin", "python3");
  if (fs.existsSync(py3)) fs.chmodSync(py3, 0o755);

  // Step 3b: rebuild native node modules for the bundled node's ABI.
  // The .node binaries under dist/app were compiled against the DEVELOPMENT
  // machine's node (e.g. v24, NODE_MODULE_VERSION 137), but the bundle ships
  // node v20 (NODE_MODULE_VERSION 115). electron-builder's npmRebuild:false
  // skips rebuild (correctly — we don't want Electron's ABI), so we rebuild
  // here against the BUNDLED node. Only modules that bind to a specific node
  // ABI need this; N-API modules (sharp, @node-rs/*) are ABI-stable and don't.
  // better-sqlite3 uses NAN (version-specific), so it must be rebuilt.
  rebuildNativeModulesForBundledNode(APP);

  // Step 4: embedding model (operator-provided; fail clearly if absent)
  log("Step 4: copy embedding model");
  if (!fs.existsSync(MODEL_SRC)) {
    fail(`embedding model not found at ${path.relative(ROOT, MODEL_SRC)}.\n` +
         `Place the GTE-multilingual-base ONNX model directory there, then re-run.\n` +
         `(This mirrors the Windows build, which also requires the operator to pre-place the model.)`);
  }
  copyDir(MODEL_SRC, path.join(APP, "models", "gte-multilingual-base"));
  log(`✓ model copied`);

  // Step 5: report
  const size = dirSize(APP);
  log(`────────────────────────────────────────`);
  log(`✓ dist/app assembled: ${human(size)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`  next: run \`node scripts/build-electron-mac.mjs\` to build the DMG`);
}

main().catch((e) => { console.error(e); process.exit(1); });
