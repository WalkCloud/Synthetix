/**
 * Runtime-layer fingerprint for the patch-update safety guard.
 *
 * Extracted into its own module (rather than living in win-patch-applier.ts) to
 * avoid a circular import: updater.ts needs computeRuntimeHash() at check time,
 * and win-patch-applier.ts imports the Applier type from updater.ts. Keeping
 * the hash function dependency-free breaks the cycle.
 *
 * The fingerprint covers exactly the files a JS-only content zip is NOT allowed
 * to touch: the bundled node + python binaries, every native .node module, and
 * the Python worker sources. If any of these differ between the running install
 * and the manifest's minRuntimeHash, a patch is unsafe and must downgrade to a
 * full reinstall.
 *
 * scripts/publish-release.mjs uses this to populate minRuntimeHash on publish;
 * electron/updater.ts uses it to verify before offering the patch path.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Compute the runtime-layer hash for the app at `appRootDir`.
 * Deterministic: file paths are sorted and normalized to forward slashes before
 * hashing, so the same install produces the same hash regardless of cwd.
 */
export function computeRuntimeHash(appRootDir: string): string {
  const hash = crypto.createHash("sha256");
  const files: string[] = [];

  // node + python binaries.
  const nodeExe = path.join(
    appRootDir,
    "runtime",
    process.platform === "win32" ? "node.exe" : "node"
  );
  const pyExe = path.join(
    appRootDir,
    "runtime",
    "python",
    process.platform === "win32" ? "python.exe" : "python3"
  );
  if (fs.existsSync(nodeExe)) files.push(nodeExe);
  if (fs.existsSync(pyExe)) files.push(pyExe);

  // All native .node modules under node_modules.
  collectFiles(path.join(appRootDir, "node_modules"), ".node", files);
  // Python worker sources.
  collectFiles(path.join(appRootDir, "workers", "python"), ".py", files);

  files.sort();
  for (const f of files) {
    // Hash the path RELATIVE to appRootDir so the hash is reproducible across
    // machines with different install locations (publisher vs client).
    const rel = path.relative(appRootDir, f).replace(/\\/g, "/");
    hash.update(rel);
    hash.update("\0");
    try {
      const buf = fs.readFileSync(f);
      hash.update(crypto.createHash("sha256").update(buf).digest("hex"));
    } catch {
      // A missing file mid-hash is recorded as an absence rather than crashing.
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Recursively gather files with a given extension under `dir` into `out`. */
function collectFiles(dir: string, ext: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip enormous/irrelevant subtrees to keep the hash fast.
      if (e.name === ".git" || e.name === ".cache") continue;
      collectFiles(full, ext, out);
    } else if (e.isFile() && e.name.endsWith(ext)) {
      out.push(full);
    }
  }
}
