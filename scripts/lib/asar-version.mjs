/**
 * Read the version string from the `package.json` baked inside an Electron
 * app.asar archive, without extracting it.
 *
 * Used by:
 *   - scripts/verify-version-consistency.mjs  (publish/readiness gate)
 *   - scripts/build-electron.mjs             (refuse to reuse a stale
 *                                             win-unpacked dir)
 *
 * `@electron/asar` is a transitive dependency of `electron-builder`, so it
 * lives under node_modules/.pnpm rather than at a top-level path. We probe a
 * small set of candidate specifiers and fall back to the pnpm store layout
 * so this keeps working whether or not the package is hoisted.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");

/** Candidate specifiers / paths probed in order for the asar reader. */
const ASAR_RESOLVE_CANDIDATES = [
  "@electron/asar",
  "electron-builder/asar",
  // pnpm non-hoisted layout: node_modules/.pnpm/@electron+asar@<ver>/node_modules/@electron/asar
  ...findPnpmAsarCandidates(),
];

/** Locate @electron+asar dirs under node_modules/.pnpm (pnpm non-hoisted). */
function findPnpmAsarCandidates() {
  const pnpmDir = path.join(ROOT, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) return [];
  try {
    return fs
      .readdirSync(pnpmDir)
      .filter((d) => d.startsWith("@electron+asar@"))
      .map((d) =>
        path.join(pnpmDir, d, "node_modules", "@electron", "asar")
      );
  } catch {
    return [];
  }
}

let _asarReader = null;

/**
 * Lazily resolve and cache the @electron/asar module. Returns an object with
 * `extractFile` and `statFile`, or null if no asar reader is installed.
 */
function asarReader() {
  if (_asarReader !== null) return _asarReader;
  const require = createRequire(import.meta.url);
  for (const candidate of ASAR_RESOLVE_CANDIDATES) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.extractFile === "function") {
        _asarReader = mod;
        return _asarReader;
      }
    } catch {
      // try next candidate
    }
  }
  _asarReader = false; // cache the miss; distinguish from `null` (not yet probed)
  return _asarReader;
}

/**
 * @returns {boolean} true iff an asar reader is installed in this tree.
 */
export function isAsarReaderAvailable() {
  return !!asarReader();
}

/**
 * Read `package.json` from inside an asar archive and return its parsed
 * contents.
 *
 * @param {string} asarPath  Absolute path to `resources/app.asar`.
 * @returns {{ version?: string, [k: string]: unknown }}
 * @throws If the reader is unavailable, the archive is missing, or the inner
 *         package.json is unreadable / not JSON.
 */
export function readPackageJsonFromAsar(asarPath) {
  const reader = asarReader();
  if (!reader) {
    throw new Error(
      "@electron/asar not installed — cannot read app.asar. " +
        "Run `pnpm add -D @electron/asar` or build with electron-builder present."
    );
  }
  if (!fs.existsSync(asarPath)) {
    throw new Error(`asar archive not found: ${asarPath}`);
  }
  const raw = reader.extractFile(asarPath, "package.json");
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `app.asar package.json is not valid JSON: ${e.message}`
    );
  }
}

/**
 * Resolve the version baked into an unpacked Electron build's app.asar.
 *
 * Accepts either the unpacked dir (contains `resources/app.asar`) or the
 * asar path directly. Returns `null` if the archive or its package.json is
 * absent (e.g. the dir predates a build).
 *
 * @param {string} unpackedDirOrAsar
 * @returns {string | null}
 */
export function asarVersionOrNull(unpackedDirOrAsar) {
  let asarPath = unpackedDirOrAsar;
  if (!unpackedDirOrAsar.endsWith(".asar")) {
    asarPath = path.join(unpackedDirOrAsar, "resources", "app.asar");
  }
  if (!fs.existsSync(asarPath)) return null;
  try {
    const pkg = readPackageJsonFromAsar(asarPath);
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
