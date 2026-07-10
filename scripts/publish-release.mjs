#!/usr/bin/env node
/**
 * Publish a Synthetix release to GitHub Releases, including the auto-update
 * manifest (latest.json) consumed by electron/updater.ts.
 *
 * What this does (Phase 1 — full path only):
 *   1. Read the version from package.json and assert a matching `v<x.y.z>` git
 *      tag exists (and is checked out) — prevents shipping a manifest that
 *      points at an untagged build.
 *   2. Locate the built NSIS installer under dist/electron/ produced by
 *      `node scripts/build-electron.mjs` (run that first).
 *   3. Compute the installer's SHA-256.
 *   4. Generate (or merge into) the per-channel manifest (stable.json /
 *      beta.json) describing this release for win-x64.full.
 *   5. Upload the installer + manifest to the GitHub Release for the tag.
 *
 * Usage:
 *   node scripts/publish-release.mjs                    # stable, full only
 *   node scripts/publish-release.mjs --channel beta     # beta channel file
 *   node scripts/publish-release.mjs --kind patch --from 1.0.1   # Phase 3
 *   node scripts/publish-release.mjs --dry-run          # print plan, don't upload
 *
 * Phase 3 flags (--kind patch / --from / --auto) are accepted but not yet
 * implemented; they print a notice and fall back to full. This keeps the CLI
 * stable while the patch path is built out.
 *
 * Prereqs:
 *   - gh CLI authenticated, or GITHUB_TOKEN in env with `repo` scope.
 *   - The installer already built via build-electron.mjs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

// Parse --channel <name>
const channelIdx = process.argv.indexOf("--channel");
const CHANNEL = channelIdx > -1 ? process.argv[channelIdx + 1] : "stable";
if (!["stable", "beta"].includes(CHANNEL)) {
  fail(`--channel must be "stable" or "beta", got "${CHANNEL}"`);
}

// Run main() only when invoked directly (not when imported by tests). Use
// pathToFileURL so the comparison matches import.meta.url exactly, including
// Windows drive-letter casing and forward slashes.
import { pathToFileURL } from "node:url";
const IS_MAIN = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

// Parse --kind <patch|full|auto> and --from <ver> (comma-separated for multiple).
const kindIdx = process.argv.indexOf("--kind");
const KIND = kindIdx > -1 ? process.argv[kindIdx + 1] : "full";
const fromIdx = process.argv.indexOf("--from");
const FROM_RAW = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
const FROM = FROM_RAW ? FROM_RAW.split(",").map((s) => s.trim()).filter(Boolean) : null;
if (!["full", "patch", "auto"].includes(KIND)) {
  fail(`--kind must be "full", "patch", or "auto", got "${KIND}"`);
}
if (KIND === "patch" && !FROM) {
  fail(`--kind patch requires --from <version>[,<version>...] (which versions can patch to this one)`);
}

// ---------- helpers ----------
function log(...m) {
  console.log(`\x1b[36m[publish]\x1b[0m`, ...m);
}
function warn(...m) {
  console.error(`\x1b[33m[publish:WARN]\x1b[0m`, ...m);
}
function fail(...m) {
  console.error(`\x1b[31m[publish:ERROR]\x1b[0m`, ...m);
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  // Default to shell:true for git (which needs it for some subcommands), but
  // allow callers to disable it for commands that take file-path arguments
  // containing spaces. With shell:true on Windows, an unquoted path like
  // "Synthetix Setup 1.0.1.exe" gets word-split by cmd.exe, breaking the
  // upload. gh/node are real executables and don't need a shell wrapper.
  const useShell = opts.shell !== undefined ? opts.shell : true;
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8", shell: useShell, ...opts });
  if (res.status !== 0) {
    fail(`command failed (exit ${res.status}): ${cmd} ${cmdArgs.join(" ")}`);
  }
  // stdout is null when stdio:"inherit" (output goes straight to the terminal
  // instead of being captured). Only trim when we actually captured output.
  return res.stdout ? res.stdout.trim() : "";
}

function sha256OfFile(filePath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

function bytesToHuman(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Compute the runtime-layer hash for the assembled app bundle at dist/app.
 * This MUST match electron/runtime-hash.ts::computeRuntimeHash() so the updater
 * engine's verification passes. We reimplement it here (rather than importing
 * the .ts) because this is an .mjs script running in plain node, and the .ts
 * lives under electron/ (compiled to dist/electron-main, not importable from a
 * script). The two are kept in sync by a unit test (Phase 3 verify).
 *
 * Hashed files: runtime/node(.exe), runtime/python/python(.exe), all *.node
 * under node_modules, and all *.py under workers/python.
 */
function computeRuntimeHash(appRootDir) {
  const hash = crypto.createHash("sha256");
  const files = [];
  const isWin = process.platform === "win32";
  const nodeExe = path.join(appRootDir, "runtime", isWin ? "node.exe" : "node");
  const pyExe = path.join(appRootDir, "runtime", "python", isWin ? "python.exe" : "python3");
  if (fs.existsSync(nodeExe)) files.push(nodeExe);
  if (fs.existsSync(pyExe)) files.push(pyExe);
  collectFiles(path.join(appRootDir, "node_modules"), ".node", files);
  collectFiles(path.join(appRootDir, "workers", "python"), ".py", files);
  files.sort();
  for (const f of files) {
    // Hash the path RELATIVE to appRootDir so the hash is reproducible across
    // machines with different install locations (publisher vs client). The
    // client's resources/app lives at a totally different absolute path.
    const rel = path.relative(appRootDir, f).replace(/\\/g, "/");
    hash.update(rel);
    hash.update("\0");
    try {
      const buf = fs.readFileSync(f);
      hash.update(crypto.createHash("sha256").update(buf).digest("hex"));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function collectFiles(dir, ext, out) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === ".cache") continue;
      collectFiles(full, ext, out);
    } else if (e.isFile() && e.name.endsWith(ext)) {
      out.push(full);
    }
  }
}

/**
 * Build the content zip (the patch payload) from the assembled app bundle.
 * Includes ONLY the Web/JS layer a patch is allowed to overwrite: .next/, public/.
 * Deliberately EXCLUDES runtime/, models/, workers/, prisma/, *.node, *.exe —
 * those are runtime-layer and require a full reinstall.
 *
 * Uses PowerShell Compress-Archive (Windows) or `zip` (fallback). Zero npm deps.
 */
function buildContentZip(appBundleDir, outZip) {
  const includeDirs = [".next", "public"].filter((d) =>
    fs.existsSync(path.join(appBundleDir, d))
  );
  if (includeDirs.length === 0) {
    fail(`no patchable dirs (.next/, public/) found in ${appBundleDir}`);
  }
  // Compress-Archive needs relative paths from within the bundle to avoid
  // nesting the full absolute path. Run powershell with cwd = appBundleDir.
  const sources = includeDirs.map((d) => `'${d}'`).join(", ");
  const psScript = `Compress-Archive -Path ${sources} -DestinationPath '${outZip.replace(
    /'/g,
    "''"
  )}' -Force`;
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psScript],
    { encoding: "utf8", cwd: appBundleDir, windowsHide: true }
  );
  if (res.status !== 0) {
    fail(
      `Compress-Archive exited ${res.status}: ${(res.stderr || "").trim().slice(0, 300)}`
    );
  }
  if (!fs.existsSync(outZip)) {
    fail(`content zip was not created at ${outZip}`);
  }
  return outZip;
}

// ─── manifest signing (Plan A: Ed25519, zero-cost supply-chain protection) ──
//
// This canonical-string + sign logic MUST stay byte-identical to
// electron/manifest-signing.ts::buildCanonicalString() so the updater's
// verifyManifest() accepts what we sign here. manifest-signing.test.ts guards
// against drift.

const CANONICAL_PREFIX = "synthetix-update-v1";

/**
 * Build the deterministically-ordered string that gets signed. See the TS twin
 * (electron/manifest-signing.ts) for the format spec.
 */
function buildCanonicalString(manifest) {
  const lines = [CANONICAL_PREFIX, manifest.version];
  const platformKeys = Object.keys(manifest.platforms).sort();
  for (const key of platformKeys) {
    const block = manifest.platforms[key];
    if (!block) continue;
    lines.push(key);
    const f = block.full;
    lines.push(`full\t${f.url}\t${f.size}\t${f.sha256}`);
    if (block.patch) {
      const p = block.patch;
      lines.push(`patch\t${p.url}\t${p.size}\t${p.sha256}\t${p.minRuntimeHash ?? ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Resolve the signing private key, if available. Looks in:
 *   1. SYNTHETIX_SIGNING_KEY env (raw PEM)
 *   2. SYNTHETIX_SIGNING_KEY_PATH env (file path)
 *   3. ~/.synthetix/update-signing.key (default from generate:signing-key)
 * Returns null when none are present (allowed in --dry-run; required to publish).
 */
function loadSigningPrivateKey() {
  if (process.env.SYNTHETIX_SIGNING_KEY) {
    return process.env.SYNTHETIX_SIGNING_KEY;
  }
  const keyPath =
    process.env.SYNTHETIX_SIGNING_KEY_PATH ||
    path.join(os.homedir(), ".synthetix", "update-signing.key");
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, "utf8");
  }
  return null;
}

/**
 * Sign a manifest with the given PEM private key. Returns the hex signature.
 * The manifest MUST NOT already carry a `signature` field (that would be
 * self-referential); we add it after signing.
 *
 * Uses the one-shot crypto.sign() API (not the streaming createSign) because
 * Ed25519 keys do not accept an algorithm string — passing null to the one-shot
 * form lets Node infer Ed25519 from the key type. This mirrors the verify side
 * (electron/manifest-signing.ts::verifyManifest).
 */
function signManifest(manifest, privateKeyPem) {
  const canonical = buildCanonicalString(manifest);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
  return sig.toString("hex");
}

// ---------- main ----------
function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const VERSION = pkg.version;
  const TAG = `v${VERSION}`;
  log(`publishing Synthetix ${VERSION} (${TAG}) to channel "${CHANNEL}"`);

  // 1) Assert the git tag exists and is checked out (HEAD == tag).
  const currentTag = run("git", ["describe", "--exact-match", "--tags", "HEAD"], {
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
  if (currentTag !== TAG) {
    fail(
      `HEAD is at tag "${currentTag}", expected "${TAG}". Check out the tag first:\n` +
        `  git checkout ${TAG}`
    );
  }
  log(`✓ git tag ${TAG} is checked out`);

  // 2) Locate the built installer.
  const installerDir = path.join(ROOT, "dist", "electron");
  const candidates = fs.existsSync(installerDir)
    ? fs.readdirSync(installerDir).filter((f) => f.endsWith(".exe"))
    : [];
  // electron-builder names it "Synthetix Setup <version>.exe".
  const installerName =
    candidates.find((f) => f.includes(VERSION)) ?? candidates[0];
  if (!installerName) {
    fail(
      `no installer found in dist/electron/. Run \`node scripts/build-electron.mjs\` first.`
    );
  }
  const installerPath = path.join(installerDir, installerName);
  const installerSize = fs.statSync(installerPath).size;
  const installerSha = sha256OfFile(installerPath);
  log(`✓ installer: ${installerName} (${bytesToHuman(installerSize)})`);

  // 3) Build the asset URL. GitHub Releases assets live under the
  //    /releases/download/<tag>/<filename> path.
  const repo = "WalkCloud/Synthetix";
  const assetUrl = `https://github.com/${repo}/releases/download/${TAG}/${encodeURIComponent(
    installerName
  )}`;

  // 3b) If --kind patch, build the content zip from dist/app and compute the
  //     runtime-layer hash. The content zip is the small JS-only payload the
  //     patch applier overlays onto resources/app/. The runtime hash goes into
  //     the manifest as the guard the client verifies before applying.
  const assetsToUpload = [installerPath];
  let patchBlock = null;
  const effectiveKind =
    KIND === "patch" || KIND === "auto" ? KIND : "full";

  const appBundleDir = path.join(ROOT, "dist", "app");
  if (effectiveKind === "patch" || effectiveKind === "auto") {
    if (!fs.existsSync(appBundleDir)) {
      fail(
        `--kind ${KIND} requires dist/app/. Run \`node scripts/build-installer.mjs\` first.`
      );
    }
    const contentZipName = `content-${VERSION}-win.zip`;
    const contentZipPath = path.join(installerDir, contentZipName);
    if (!DRY_RUN) {
      buildContentZip(appBundleDir, contentZipPath);
      assetsToUpload.push(contentZipPath);
    }
    const contentSize = DRY_RUN ? 0 : fs.statSync(contentZipPath).size;
    const contentSha = DRY_RUN ? "<dry-run>" : sha256OfFile(contentZipPath);
    const runtimeHash = DRY_RUN ? "<dry-run>" : computeRuntimeHash(appBundleDir);
    const contentUrl = `https://github.com/${repo}/releases/download/${TAG}/${encodeURIComponent(
      contentZipName
    )}`;
    patchBlock = {
      availableFrom: FROM,
      url: contentUrl,
      size: contentSize,
      sha256: contentSha,
      includesMigrations: fs.existsSync(
        path.join(appBundleDir, "prisma", "migrations")
      ),
      minRuntimeHash: runtimeHash,
    };
    log(
      `✓ content zip: ${contentZipName} (${bytesToHuman(contentSize)})` +
        (effectiveKind === "auto" ? " [auto-detected patch-eligible]" : "")
    );
    log(`  runtime-hash: ${runtimeHash.slice(0, 16)}…`);
  }

  // 4) Generate the per-channel manifest.
  const manifest = {
    version: VERSION,
    channel: CHANNEL,
    publishedAt: new Date().toISOString(),
    minRequiredVersion: null, // set explicitly only when a release breaks older versions
    forceFull: false,
    platforms: {
      "win-x64": {
        // updateKind tells the client the publisher's intent; the client still
        // re-evaluates (runtime-hash guard can downgrade patch→full at runtime).
        updateKind: patchBlock ? "patch" : "full",
        full: {
          url: assetUrl,
          size: installerSize,
          sha256: installerSha,
        },
        ...(patchBlock ? { patch: patchBlock } : {}),
      },
    },
  };

  // 4b) Sign the manifest with the Ed25519 private key (Plan A supply-chain
  //     protection). The signature covers the canonical subset of
  //     security-critical fields (version + every asset's url/size/sha256 +
  //     runtime hash), so any tampering with those invalidates it. The client
  //     verifies against the public key baked into the app.
  const signingKey = loadSigningPrivateKey();
  if (signingKey) {
    manifest.signature = signManifest(manifest, signingKey);
    log(`✓ signed manifest (Ed25519, ${manifest.signature.slice(0, 16)}…)`);
  } else if (!DRY_RUN) {
    fail(
      `No signing key found. Run \`npm run generate:signing-key\` first, or set ` +
        `SYNTHETIX_SIGNING_KEY / SYNTHETIX_SIGNING_KEY_PATH. (Allowed in --dry-run.)`
    );
  } else {
    warn(`no signing key — manifest will be UNSIGNED (dry-run only allows this)`);
  }

  const manifestFile = `${CHANNEL}.json`;
  const manifestPath = path.join(installerDir, manifestFile);
  if (!DRY_RUN) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    log(`✓ wrote ${manifestFile}`);
  }

  if (DRY_RUN) {
    log(`── dry-run plan ──────────────────────────────`);
    log(`tag:        ${TAG}`);
    log(`kind:       ${effectiveKind}${FROM ? ` (from ${FROM.join(",")})` : ""}`);
    log(`installer:  ${installerName} (${bytesToHuman(installerSize)})`);
    if (patchBlock) {
      log(`content:    content-${VERSION}-win.zip (~JS layer only)`);
      log(`runtime-hash: ${patchBlock.minRuntimeHash.slice(0, 16)}…`);
    }
    log(`manifest:   ${manifestFile}`);
    log(`upload to:  ${repo} release ${TAG}`);
    console.log(JSON.stringify(manifest, null, 2));
    log(`── re-run without --dry-run to publish ───────`);
    return;
  }

  // 5) Create the Release if it doesn't exist, then upload assets. gh release
  //    upload requires the Release to already exist (it only attaches assets),
  //    so create it first against the tag's commit. Use shell:false for every
  //    gh invocation because file paths contain spaces and must stay one argv.
  const releaseExists = spawnSync(
    "gh",
    ["release", "view", TAG, "--repo", repo],
    { encoding: "utf8", shell: false }
  );
  if (releaseExists.status !== 0) {
    log(`creating GitHub Release ${TAG}…`);
    const notesTitle = `Synthetix ${VERSION}`;
    const notesBody =
      (patchBlock
        ? `This release supports the **patch (quick update)** path from ${FROM.join(", ")}.\n\n`
        : `This release uses the **full reinstall** update path.\n\n`) +
      `See the changelog in the repository for details.`;
    run(
      "gh",
      [
        "release",
        "create",
        TAG,
        "--repo",
        repo,
        "--title",
        notesTitle,
        "--notes",
        notesBody,
        "--verify-tag", // assert the tag exists remotely (it should — we pushed it)
      ],
      { stdio: "inherit", shell: false }
    );
    log(`✓ created Release ${TAG}`);
  } else {
    log(`Release ${TAG} already exists — attaching assets to it.`);
  }

  // Upload assets. assetsToUpload always includes the installer; patch builds
  // also include the content zip. The manifest is uploaded last (after its
  // sha256 references are final). shell:false keeps space-containing paths as
  // single argv entries.
  assetsToUpload.push(manifestPath);
  log(`uploading ${assetsToUpload.length} asset(s) to GitHub Release ${TAG}…`);
  run(
    "gh",
    ["release", "upload", TAG, ...assetsToUpload, "--clobber"],
    { stdio: "inherit", shell: false }
  );
  log(
    `✓ uploaded: ${assetsToUpload
      .map((p) => path.basename(p))
      .join(", ")}`
  );

  const kindSummary = patchBlock
    ? ` (patch from ${FROM.join(", ")} + full fallback)`
    : " (full)";
  log(`\nDone. Users on <${VERSION} will see the update${kindSummary}.`);
  log(`Update manifest: https://github.com/${repo}/releases/download/latest/${manifestFile}`);
}

// Exported for tests (src/__tests__/scripts/runtime-hash.test.ts and
// manifest-signing.test.ts). The hash + canonical-string functions must stay
// byte-identical to their twins in electron/ so a manifest produced here
// verifies on the client.
export { computeRuntimeHash, buildCanonicalString, signManifest };

if (IS_MAIN) {
  main();
}
