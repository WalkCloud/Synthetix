#!/usr/bin/env node
/**
 * Synthetix — third-party notices generator.
 *
 * Scans npm, Python, Electron, and hand-curated asset dependencies, then emits:
 *   - public/legal/third-party-notices.json   (page data)
 *   - public/legal/THIRD-PARTY-NOTICES.txt     (download / distribution)
 *
 * The exports in the lower half of this file (scanNpm, scanPython, scanElectron,
 * scanAssets, generateNotices, writeNotices) are reused by build-installer.mjs
 * so the packaged bundle ships identical legal artifacts.
 *
 * License hygiene: Unknown / Custom / copyleft (GPL/LGPL/AGPL/MPL) entries are
 * reported. In strict mode (NOTICES_STRICT=1 or { strict: true }) the script
 * exits non-zero so a release build cannot ship uninspectable licenses.
 *
 * Usage:  node scripts/generate-third-party-notices.mjs [--out <dir>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUDED_PYTHON_SET, normalizePkgName } from "./python-excluded-packages.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __filename;

// ---------- helpers ----------
function log(...m) {
  console.log(`\x1b[36m[gen-notices]\x1b[0m`, ...m);
}
function warn(...m) {
  console.error(`\x1b[33m[gen-notices:WARN]\x1b[0m`, ...m);
}

// Licenses that block distribution until a human reviews them.
const COPYLEFT = ["GPL", "LGPL", "AGPL", "MPL"];
// SPDX-ish labels treated as "unknown" (need manual triage).
const UNKNOWN_LABELS = ["UNKNOWN", "UNLICENSED", "SEE LICENSE IN", "Custom", "Other"];

function isCopyleft(lic) {
  return COPYLEFT.some((c) => lic.includes(c));
}
function isUnknown(lic) {
  if (!lic) return true;
  return UNKNOWN_LABELS.some((u) => lic.toUpperCase().includes(u.toUpperCase()));
}

// ---------- npm scanner ----------
/**
 * Packages that live in devDependencies but ARE shipped in the distributed app,
 * so they must appear in the notices despite not being runtime `dependencies`.
 * Keep this list minimal — only things physically bundled into the installer.
 */
const NPM_SHIPPED_DEV_DEPS = new Set(["electron", "electron-builder"]);

/**
 * Build-time-only tooling that leaks into the production dependency closure
 * via transitive `dependencies` but is NOT shipped in the runtime bundle.
 * These produce compiled output (CSS, JS) but the tools themselves don't run
 * in the distributed app, so they carry no distribution obligation.
 *
 * - tailwindcss / postcss: compile CSS at build time; only the compiled CSS ships
 * - @types/node, @types/pg: TypeScript declarations, stripped at build time
 */
const NPM_BUILD_TIME_EXCLUDE = new Set([
  "tailwindcss",
  "@tailwindcss/node",
  "@tailwindcss/oxide",
  "postcss",
  "@types/node",
  "@types/pg",
]);

/**
 * Resolve the production dependency closure from package.json `dependencies`,
 * then collect license info for each resolved package from node_modules.
 *
 * Dev-only tooling (playwright, eslint, vitest, typescript, @types/*, etc.) is
 * excluded because it never ships in the distributed app and carries no
 * distribution obligation. Packages in {@link NPM_SHIPPED_DEV_DEPS} are added
 * back explicitly.
 *
 * @param {string} nmRoot        node_modules directory to read package.json from
 * @param {string} [pkgJsonPath] path to the project package.json (roots source)
 * @returns {Array} notice entries for production deps only
 */
export function scanNpm(nmRoot, pkgJsonPath) {
  if (!fs.existsSync(nmRoot)) return [];
  const rootPkg = pkgJsonPath
    ? JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
    : JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  // Seed the BFS with production deps + explicitly-shipped dev deps.
  const roots = new Set([
    ...Object.keys(rootPkg.dependencies || {}),
    ...Object.keys(rootPkg.devDependencies || {}).filter((d) => NPM_SHIPPED_DEV_DEPS.has(d)),
  ]);

  // BFS: resolve each name → its package.json → its runtime dependencies.
  const closure = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift();
    if (closure.has(name) || NPM_BUILD_TIME_EXCLUDE.has(name)) continue;
    const pj = findPkgJson(nmRoot, name);
    if (!pj) continue; // not installed / resolvable → skip
    closure.add(name);
    const pkg = safeReadJson(pj);
    if (pkg?.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        if (!closure.has(dep)) queue.push(dep);
      }
    }
    // NOTE: peerDependencies and optionalDependencies are intentionally
    // excluded. Peer deps are host-provided build/dev requirements (e.g. next
    // declares @playwright/test, prisma declares typescript) — they are NOT
    // runtime code bundled into the distributed app and carry no distribution
    // obligation. Including them would pollute the notices with dev tooling.
  }

  // Collect license info for each resolved package.
  const entries = [];
  for (const name of closure) {
    const pj = findPkgJson(nmRoot, name);
    if (!pj) continue;
    const e = readPkgEntry(pj);
    if (e) entries.push(e);
  }
  return entries;
}

/**
 * Locate a package's package.json inside a (pnpm-hoisted) node_modules tree,
 * handling @scope names. Returns null if not found.
 */
function findPkgJson(nmRoot, name) {
  const candidates =
    name.startsWith("@") && name.includes("/")
      ? // scoped package already has a path segment
        [path.join(nmRoot, name)]
      : [path.join(nmRoot, name), ...globScope(nmRoot, name)];
  for (const c of candidates) {
    const pj = path.join(c, "package.json");
    if (fs.existsSync(pj)) return pj;
  }
  return null;
}

/** For a bare name, also probe @scope dirs (e.g. @types/react). */
function globScope(nmRoot, name) {
  const out = [];
  try {
    for (const entry of fs.readdirSync(nmRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("@")) {
        const pj = path.join(nmRoot, entry.name, name, "package.json");
        if (fs.existsSync(pj)) out.push(path.join(nmRoot, entry.name, name));
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Read a single package.json into a notice entry (license, text, copyright). */
function readPkgEntry(pjPath) {
  const pkg = safeReadJson(pjPath);
  if (!pkg?.name) return null;
  const dir = path.dirname(pjPath);
  const license = resolveLicenseField(pkg, dir);
  return {
    name: pkg.name,
    version: pkg.version || "",
    license,
    homepage: pkg.homepage || undefined,
    repository: repoUrl(pkg.repository),
    source: "npm",
    copyright: extractCopyright(dir, license),
    licenseText: readLicenseText(dir),
  };
}

/** Resolve the `license` field, following `SEE LICENSE IN <path>` references. */
function resolveLicenseField(pkg, dir) {
  let raw = pkg.license;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    raw = pkg.licenses[0]?.type || pkg.licenses.map((l) => l.type).join(", ");
  }
  if (typeof raw === "object" && raw) raw = raw.type;
  if (typeof raw !== "string") return "UNKNOWN";
  const m = raw.match(/SEE LICENSE IN\s+(.+)/i);
  if (m) {
    const refPath = path.join(dir, m[1].trim());
    // We can't infer SPDX from a referenced file; keep a marker so the page
    // can show the text while flagging it for review.
    return `SEE LICENSE IN ${m[1].trim()}`;
  }
  return raw;
}

function repoUrl(repo) {
  if (!repo) return undefined;
  if (typeof repo === "string") return repo;
  return repo.url;
}

/** Try to read LICENSE/LICENCE text from a package directory. */
function readLicenseText(dir) {
  for (const cand of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"]) {
    const p = path.join(dir, cand);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, "utf8").slice(0, 20000); // cap to keep JSON sane
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

/** Best-effort copyright extraction from LICENSE text first line(s). */
function extractCopyright(dir, license) {
  const txt = readLicenseText(dir);
  if (!txt) return undefined;
  const lines = txt.split(/\r?\n/).slice(0, 10);
  const hits = lines.filter((l) => /copyright\s+\(c\)|copyright\s+©|©|copyright/i.test(l));
  return hits.length ? hits : undefined;
}

// ---------- Python scanner ----------
/**
 * Resolve the Python worker dependency tree via importlib.metadata, starting
 * from the packages declared in requirements.txt and walking their transitive
 * closure. This avoids scanning the entire system site-packages (which would
 * pull in unrelated packages like Flask, requests, etc. that the worker never
 * imports).
 *
 * The resolution runs in a dedicated script file (_resolve-python-deps.py) to
 * avoid embedding Python source in a JS template literal (which mangles quotes
 * and newlines). The script emits NDJSON on stdout; we parse each line here.
 *
 * @param {string} requirementsPath  absolute path to workers/python/requirements.txt
 * @returns {Array}  notice entries (empty if Python unavailable)
 */
export function scanPython(requirementsPath) {
  const pyExe = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
  const reqFile = requirementsPath || path.join(ROOT, "workers", "python", "requirements.txt");
  const resolver = path.join(ROOT, "scripts", "_resolve-python-deps.py");

  const res = spawnSync(pyExe, [resolver, reqFile], { encoding: "utf8" });
  if (res.status === 2) {
    warn("python importlib.metadata unavailable — skipping Python scan");
    return [];
  }
  if (res.status === 3) {
    warn(`requirements.txt not found at ${reqFile} — skipping Python scan`);
    return [];
  }
  if (res.status !== 0) {
    warn(`python scan failed (exit ${res.status}) — skipping Python scan`);
    if (res.stderr) warn(res.stderr.slice(0, 200));
    return [];
  }
  const entries = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const entry = JSON.parse(s);
      // Skip packages that are stripped from the distributed app (see
      // python-excluded-packages.mjs) so the notices reflect what ships.
      if (EXCLUDED_PYTHON_SET.has(normalizePkgName(entry.name))) continue;
      entries.push(entry);
    } catch {
      /* skip malformed */
    }
  }
  return entries;
}

// ---------- Electron scanner ----------
export function scanElectron(nmRoot) {
  const out = [];
  for (const name of ["electron", "electron-builder"]) {
    const pj = path.join(nmRoot, name, "package.json");
    if (!fs.existsSync(pj)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
      out.push({
        name: pkg.name,
        version: pkg.version || "",
        license: resolveLicenseField(pkg, path.dirname(pj)),
        homepage: pkg.homepage || undefined,
        repository: repoUrl(pkg.repository),
        source: "electron",
        licenseText: readLicenseText(path.dirname(pj)),
      });
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ---------- asset scanner ----------
export function scanAssets(manifestPath) {
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return (Array.isArray(data) ? data : []).map((a) => ({ ...a, source: a.source || "asset" }));
  } catch (e) {
    warn(`failed to read asset manifest ${manifestPath}: ${e.message}`);
    return [];
  }
}

// ---------- assembly + validation ----------
export function generateNotices(opts = {}) {
  const {
    nmRoot = path.join(ROOT, "node_modules"),
    bundleRoot = null, // dist/app — if set, scan its node_modules too
    rootPkgJson = path.join(ROOT, "package.json"),
    requirementsPath = path.join(ROOT, "workers", "python", "requirements.txt"),
    assetManifest = path.join(ROOT, "legal", "assets-notices.json"),
    strict = process.env.NOTICES_STRICT === "1",
  } = opts;

  const npm = scanNpm(nmRoot, rootPkgJson);
  const npmBundle = bundleRoot ? scanNpm(path.join(bundleRoot, "node_modules"), rootPkgJson) : [];
  const python = scanPython(requirementsPath);
  const assets = scanAssets(assetManifest);

  // Global dedup by name across ALL sources. electron/electron-builder are now
  // included via the npm production-closure scan (NPM_SHIPPED_DEV_DEPS), so no
  // separate electron scan is needed. Keep first occurrence per name.
  const byName = new Map();
  for (const e of [...npm, ...npmBundle, ...python, ...assets]) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }

  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Validation: flag copyleft / unknown.
  const problems = entries.filter((e) => isCopyleft(e.license) || isUnknown(e.license));
  if (problems.length) {
    warn(`${problems.length} entr${problems.length === 1 ? "y" : "ies"} need license review:`);
    for (const p of problems.slice(0, 20)) {
      warn(`  ${p.name}@${p.version} → ${p.license} (${p.source})`);
    }
    if (problems.length > 20) warn(`  ...and ${problems.length - 20} more`);
    if (strict) {
      warn("NOTICES_STRICT=1 — aborting.");
      process.exit(1);
    }
  }

  return entries;
}

export function toTxt(entries, projectLicense) {
  const lines = [];
  lines.push("THIRD-PARTY-NOTICES");
  lines.push("===================");
  lines.push("");
  lines.push(`This product is licensed under ${projectLicense}.`);
  lines.push("It includes third-party open-source software listed below.");
  lines.push("");
  for (const e of entries) {
    lines.push("-------------------------------------------------------------------------");
    lines.push(`${e.name}@${e.version}  [${e.source}]  — ${e.license}`);
    const url = e.homepage || e.repository;
    if (url) lines.push(`  ${url}`);
    if (e.copyright?.length) {
      for (const c of e.copyright) lines.push(`  ${c}`);
    }
    if (e.licenseText) {
      lines.push("");
      const clipped = e.licenseText.length > 8000 ? e.licenseText.slice(0, 8000) + "\n…[truncated]" : e.licenseText;
      for (const ln of clipped.split(/\r?\n/)) lines.push(`  ${ln}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeNotices(entries, outDir, projectLicense) {
  fs.mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(entries, null, 2);
  fs.writeFileSync(path.join(outDir, "third-party-notices.json"), json, "utf8");
  fs.writeFileSync(path.join(outDir, "THIRD-PARTY-NOTICES.txt"), toTxt(entries, projectLicense), "utf8");
  log(`wrote ${entries.length} entries → ${path.relative(ROOT, outDir)}`);
}

// ---------- CLI entry ----------
function main() {
  const argIdx = process.argv.indexOf("--out");
  const outDir = argIdx > 0 ? path.resolve(process.argv[argIdx + 1]) : path.join(ROOT, "public", "legal");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const projectLicense = pkg.license || "UNLICENSED";

  const entries = generateNotices();
  writeNotices(entries, outDir, projectLicense);
  log(`done (${entries.length} entries, project license ${projectLicense})`);
}

if (IS_MAIN) main();
