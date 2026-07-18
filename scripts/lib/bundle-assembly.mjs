/**
 * Shared OS-agnostic bundle-assembly logic for the Windows + macOS build scripts.
 *
 * Direct, behavior-identical extraction from scripts/build-installer.mjs. Every
 * function body is a verbatim move; the only changes vs. the original are:
 *   - `export` added before each function.
 *   - Module-level path constants (ROOT/DIST/APP/PACKAGING) replaced with
 *     function parameters (rootDir / appDir).
 *   - log()/warn()/fail() replaced with passed-in `log`/`warn`/`fail` params.
 *
 * The original Windows script (scripts/build-installer.mjs) is NOT modified by
 * this file in Task 1; Task 2 rewires build-installer.mjs to import from here so
 * both the Windows and the future macOS scripts share one source of truth. The
 * Windows pipeline is verified byte-identical via a sha256 baseline in Task 2.
 *
 * Functions kept OUT of this lib (Windows-specific): run(), findIscc(), the
 * Python/Node trimmers, the .iss preparation, and the start.bat/stop.bat
 * launcher copy. See plan Task 1/2.
 */
import fs from "node:fs";
import path from "node:path";

// ---------- pure helpers ----------

/** Recursively remove a path, tolerating missing files / locked files. */
export function rmrf(target, warn, rootDir) {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    warn(`could not fully remove ${path.relative(rootDir, target)}: ${e.message}`);
  }
}

/** Total bytes of a directory tree (symlinks followed defensively). */
export function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(full);
        else total += fs.statSync(full).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

/** Count files in a directory tree (for trimming impact reporting). */
export function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else count++;
    }
  }
  return count;
}

export function human(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/** Find a package's real path in pnpm's .pnpm store. Returns null if not found. */
export function resolvePnpmPkgPath(root, pkgName) {
  const pnpmKey = pkgName.replace("/", "+");
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) return null;
  const entry = fs.readdirSync(pnpmDir, { withFileTypes: true })
    .find(e => e.isDirectory() && e.name.startsWith(pnpmKey + "@"));
  if (!entry) return null;
  const p = path.join(pnpmDir, entry.name, "node_modules", pkgName);
  return fs.existsSync(path.join(p, "package.json")) ? p : null;
}

/** Resolve a pnpm symlink to its real target. pnpm uses a virtual store:
 *  node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> is the real location;
 *  top-level node_modules/<pkg> is a symlink to it. readlinkSync gets the
 *  relative target; if resolution fails (broken links in the standalone
 *  copy), skip the entry rather than crashing. */
export function resolveSymlink(s) {
  // Try readlink first (fast, doesn't stat the target).
  try {
    const link = fs.readlinkSync(s);
    const real = path.isAbsolute(link) ? link : path.resolve(path.dirname(s), link);
    if (fs.existsSync(real)) {
      const st = fs.statSync(real);
      return { real, isDir: st.isDirectory() };
    }
  } catch { /* not a symlink or readlink failed */ }
  // Fallback: realpathSync (resolves the full chain, but may EPERM/ENOENT).
  try {
    const real = fs.realpathSync(s);
    const st = fs.statSync(real);
    return { real, isDir: st.isDirectory() };
  } catch {
    // Broken symlink — skip. This happens in standalone output where some
    // pnpm virtual-store links don't have their targets copied.
    return null;
  }
}

/** Copy a directory tree recursively (excluding nothing). */
export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      // Materialize symlinks (pnpm-style) as real files to survive packaging.
      const resolved = resolveSymlink(s);
      if (!resolved) continue; // skip broken links
      if (resolved.isDir) copyDir(resolved.real, d);
      else fs.copyFileSync(resolved.real, d);
    } else fs.copyFileSync(s, d);
  }
}

/** Copy a directory tree, skipping any top-level entry whose name is in
 *  `exclude`. Used to drop dev-only subdirs of .next (dev/, cache/, trace/). */
export function copyDirExcluding(src, dst, exclude) {
  const skip = new Set(exclude);
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      const { real, isDir } = resolveSymlink(s);
      if (isDir) copyDir(real, d);
      else fs.copyFileSync(real, d);
    } else fs.copyFileSync(s, d);
  }
}

/** Copy a single file if it exists. */
export function copyFile(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

// ---------- higher-level assembly functions ----------

/**
 * Copy the OS-agnostic root config files (package.json, prisma.config.ts,
 * .npmrc, next.config.ts) into the bundle root. Source: build-installer.mjs
 * lines 284–288. Does NOT copy the launchers (start.bat/stop.bat) — those are
 * Windows-only and stay in build-installer.mjs.
 */
export function copyRootConfigs(rootDir, appDir, warn) {
  // Files at the bundle root.
  for (const f of ["package.json", "prisma.config.ts", ".npmrc", "next.config.ts"]) {
    if (!copyFile(path.join(rootDir, f), path.join(appDir, f)))
      warn(`optional root file missing, skipped: ${f}`);
  }
}

/**
 * Copy the Next.js standalone output (server.js, .next, traced node_modules
 * minus electron/playwright) into the bundle. Source: build-installer.mjs
 * lines 295–317. `standaloneDir` is the resolved .next/standalone path.
 */
export function copyStandalone(standaloneDir, appDir, log, fail) {
  // --- Next.js standalone output ---
  // Instead of shipping the full .next + a hoisted node_modules (~65000 files),
  // we use Next's standalone tracing which produces server.js + a minimal
  // node_modules containing only the packages the server actually requires
  // (~1600 files). This cuts the install payload by ~97% in file count, which
  // is the primary fix for the 60% install stall.
  if (!fs.existsSync(path.join(standaloneDir, "server.js")))
    throw new Error("standalone output missing — ensure `output: 'standalone'` in next.config.ts");
  log("  copying standalone server.js + traced node_modules/ …");
  // server.js — the standalone entry point (replaces `next start`).
  copyFile(path.join(standaloneDir, "server.js"), path.join(appDir, "server.js"));
  // .next/server — server-side chunks and route handlers (standalone copies
  // only this subset of .next, not dev/cache/trace).
  copyDir(path.join(standaloneDir, ".next"), path.join(appDir, ".next"));
  // node_modules — standalone's traced deps. copyDir resolves pnpm symlinks
  // into real files so they survive packaging and work on the target machine.
  // Exclude dev-only packages that Next's tracer mistakenly includes.
  copyDirExcluding(
    path.join(standaloneDir, "node_modules"),
    path.join(appDir, "node_modules"),
    ["electron", "playwright", "playwright-core"]
  );
}

/**
 * Flatten pnpm's .pnpm/ virtual store into top-level node_modules/, then delete
 * the store. Source: build-installer.mjs lines 319–379 (including the final
 * .pnpm/ deletion at 374–379). `warn` is accepted for API symmetry though this
 * block only logs (the deletion warning is handled inside rmrf).
 */
export function flattenPnpmStore(appDir, log, warn) {
  // --- Flatten pnpm .pnpm/ store into top-level node_modules/ ---
  // standalone tracing + pnpm's symlink layout produces a .pnpm/ virtual store
  // where packages live at .pnpm/<pkg>@<ver>/node_modules/<pkg>/. Node's
  // require() resolves modules by walking up the directory tree looking for
  // node_modules/<name> — it does NOT look inside .pnpm/. So we must copy
  // every package from .pnpm/<pkg>@<ver>/node_modules/<pkg>/ to the top-level
  // node_modules/<pkg>/ for require() to find them.
  //
  // This is the same flattening that `pnpm install --node-linker=hoisted`
  // does, but applied to the standalone output (which already traced only
  // the needed deps — ~38 packages vs ~65000 files in a full install).
  log("  flattening .pnpm/ store to top-level node_modules/ …");
  const appPnpmDir = path.join(appDir, "node_modules", ".pnpm");
  if (fs.existsSync(appPnpmDir)) {
    for (const entry of fs.readdirSync(appPnpmDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      // Skip dev-only packages that standalone mistakenly included.
      if (/^electron@|^playwright/.test(entry.name)) continue;
      // A .pnpm/<pkg>/ entry may contain multiple packages in its
      // node_modules/ (e.g. pg-types@2.2.0/node_modules/ has pg-types,
      // pg-int8, postgres-array, etc. — pnpm hoists peer deps here).
      // Copy ALL of them, not just the first.
      const innerNm = path.join(appPnpmDir, entry.name, "node_modules");
      if (!fs.existsSync(innerNm)) continue;
      for (const sub of fs.readdirSync(innerNm, { withFileTypes: true })) {
        if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
        const src = path.join(innerNm, sub.name);
        // For scoped packages (@scope/), sub.name is "@scope" and the real
        // package is inside it (e.g. @swc/helpers). Merge into top-level
        // node_modules/@scope/ rather than skipping if @scope already exists.
        if (sub.name.startsWith("@")) {
          const scopeDst = path.join(appDir, "node_modules", sub.name);
          fs.mkdirSync(scopeDst, { recursive: true });
          // Copy each package inside the scope dir
          for (const scopedPkg of fs.readdirSync(src, { withFileTypes: true })) {
            const spSrc = path.join(src, scopedPkg.name);
            const spDst = path.join(scopeDst, scopedPkg.name);
            if (fs.existsSync(spDst)) continue;
            copyDir(spSrc, spDst);
          }
        } else {
          const dst = path.join(appDir, "node_modules", sub.name);
          if (fs.existsSync(dst)) continue;
          copyDir(src, dst);
        }
      }
    }
  }

  // Delete the .pnpm virtual store now that flattening has hoisted every
  // package to the top level. Node's require() resolves node_modules/<name> by
  // walking up the dir tree — it never looks inside .pnpm/, so the store is
  // pure dead weight (and it leaks dev-only heavy packages like electron@33
  // that standalone traced but we don't need: ~269MB / ~2700 files here).
  // (packaging lessons "future optimization #2".)
  if (fs.existsSync(appPnpmDir)) {
    const freed = dirSize(appPnpmDir);
    const files = countFiles(appPnpmDir);
    rmrf(appPnpmDir, warn, appDir);
    log(`  removed .pnpm/ store (saved ${human(freed)}, ${files} files) …`);
  }
}

/**
 * Copy the static assets that Next.js standalone omits: .next/static, prisma/,
 * workers/, public/. Source: build-installer.mjs lines 381–399.
 */
export function copyStaticAssets(rootDir, appDir, log) {
  // .next/static — standalone does NOT include static assets; copy separately.
  log("  copying .next/static …");
  copyDir(path.join(rootDir, ".next", "static"), path.join(appDir, ".next", "static"));

  // prisma schema + migrations + workers (python scripts).
  // NOTE: prisma CLI is NOT included — first-run.ts uses better-sqlite3 to
  // execute migration.sql files directly, avoiding prisma's heavy dep tree.
  log("  copying prisma/ …");
  copyDir(path.join(rootDir, "prisma"), path.join(appDir, "prisma"));
  log("  copying workers/ …");
  copyDir(path.join(rootDir, "workers"), path.join(appDir, "workers"));

  // public/ — static assets served at the root by Next.js (e.g. the brand logo
  // referenced via next/image as /logo.png). If absent in the bundle, those
  // assets 404 at runtime and next/image throws "received null".
  if (fs.existsSync(path.join(rootDir, "public"))) {
    log("  copying public/ …");
    copyDir(path.join(rootDir, "public"), path.join(appDir, "public"));
  }
}

/**
 * Generate the legal artifacts (third-party notices + LICENSE + top-level
 * THIRD-PARTY-NOTICES.txt) into the bundle. Source: build-installer.mjs
 * lines 424–450 (Step 2b). Runs BEFORE trimming so stripDocs cannot delete
 * LICENSE/NOTICE files the scanner needs. `pkgLicense` is pkg.license ||
 * "UNLICENSED" from the caller. The NOTICES_STRICT env flag is read inside
 * this function. Relative import resolves from scripts/lib/ to
 * scripts/generate-third-party-notices.mjs.
 */
export async function generateLegalArtifacts(appDir, rootDir, pkgLicense, log, warn, fail) {
  // --- Step 2b: generate legal artifacts (notices + LICENSE) ---
  // Runs BEFORE trimming so stripDocs cannot delete LICENSE/NOTICE files that
  // the scanner needs to read from next/react/react-dom/effect. The output is
  // written into dist/app so electron-builder's extraResources (dist/app →
  // resources/app, filter **/*) carries it into the installer verbatim.
  log("Step 2b/5: generate legal artifacts (notices + LICENSE)");
  try {
    const { generateNotices, writeNotices } = await import("../generate-third-party-notices.mjs");
    const notices = generateNotices({
      nmRoot: path.join(appDir, "node_modules"),
      bundleRoot: appDir,
      assetManifest: path.join(rootDir, "legal", "assets-notices.json"),
      strict: process.env.NOTICES_STRICT === "1",
    });
    // Write into the bundle's public/legal/ (served by Next.js) and root.
    fs.mkdirSync(path.join(appDir, "public", "legal"), { recursive: true });
    writeNotices(notices, path.join(appDir, "public", "legal"), pkgLicense);
    // Also drop a top-level THIRD-PARTY-NOTICES.txt + LICENSE for easy access.
    copyFile(
      path.join(appDir, "public", "legal", "THIRD-PARTY-NOTICES.txt"),
      path.join(appDir, "THIRD-PARTY-NOTICES.txt"),
    );
    copyFile(path.join(rootDir, "LICENSE"), path.join(appDir, "LICENSE"));
    log(`legal artifacts: ${notices.length} notices + LICENSE written to bundle`);
  } catch (e) {
    warn(`legal artifact generation failed (non-fatal): ${e.message}`);
  }
}
