/**
 * Pure, side-effect-free update-trust helpers. This module imports NOTHING
 * from Electron (`app`, IPC) on purpose so it can be unit-tested in plain
 * Node/vitest against the compiled output — see
 * `src/__tests__/scripts/update-policy.test.ts`.
 *
 * The updater (`electron/updater.ts`) and patch applier
 * (`electron/win-patch-applier.ts`) re-export or delegate to these helpers so
 * the trust decisions stay in one tested place.
 */

export type UpdatePath = "patch" | "full";

/**
 * Immutable asset descriptor captured at manifest-verification time. Once
 * `checkForUpdates` has verified the manifest signature, these three fields
 * are pinned — the downloader consumes them directly instead of re-fetching
 * the manifest, so a TOCTOU swap of the second manifest response cannot
 * redirect the download or replace the expected hash.
 */
export interface VerifiedAsset {
  url: string;
  size: number;
  sha256: string;
}

/**
 * The discriminator-tagged status variants the updater cares about for asset
 * resolution and IPC publication. Kept structural (no methods) so it mirrors
 * the `UpdateStatus` union in updater.ts without coupling this module to it.
 */
export type AssetStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; latestVersion: string; checkedAt: string }
  | {
      kind: "available";
      path: UpdatePath;
      version: string;
      releaseName?: string;
      sizeBytes: number;
      releaseNotes?: Record<string, string>;
      forced: boolean;
      verifiedAsset: VerifiedAsset;
    }
  | {
      kind: "downloading";
      path: UpdatePath;
      version: string;
      progress: number;
      downloadedBytes: number;
      totalBytes: number;
    }
  | { kind: "ready"; path: UpdatePath; version: string; stagedPath: string }
  | { kind: "installing"; path: UpdatePath; version: string }
  | { kind: "error"; message: string };

/**
 * Pure asset-resolution. Given the status captured at verification time,
 * returns the immutable `{ url, sha256, size, destExt, version, path }` to
 * download — or null if the status shape is not an available update with a
 * pinned descriptor. The downloader trusts ONLY this; it never re-fetches the
 * manifest, so a second-response TOCTOU swap cannot redirect the download.
 */
export function resolveDownloadAsset(
  status: AssetStatus,
): {
  url: string;
  sha256: string;
  size: number;
  destExt: "zip" | "exe";
  version: string;
  path: UpdatePath;
} | null {
  if (status.kind !== "available") return null;
  const { verifiedAsset, path: pathKind, version } = status;
  return {
    url: verifiedAsset.url,
    sha256: verifiedAsset.sha256,
    size: verifiedAsset.size,
    destExt: pathKind === "patch" ? "zip" : "exe",
    version,
    path: pathKind,
  };
}

/**
 * Strip the internal `verifiedAsset` from an `available` status before it
 * crosses the preload IPC boundary. The renderer has no need for download
 * internals (url/sha256), and not surfacing them avoids leaking the asset URL
 * into renderer/devtools. Non-`available` variants pass through unchanged.
 */
export function publicStatus<S extends AssetStatus>(status: S): S {
  if (status.kind === "available") {
    const { verifiedAsset: _drop, ...rest } = status;
    void _drop;
    return rest as S;
  }
  return status;
}

/**
 * Pure unsigned-manifest policy. Production/packaged builds always require a
 * signature. Only an unpackaged dev build that explicitly opts in via
 * SYNTHETIX_ALLOW_UNSIGNED_UPDATES=1 may skip verification — this keeps local
 * testing ergonomic without weakening the shipping trust chain.
 *
 * `appIsPackaged` and `envAllowUnsigned` are passed in (rather than read from
 * Electron `app` / `process.env` here) so the function is deterministic and
 * testable. updater.ts wires the real reads.
 */
export function shouldAllowUnsignedManifest(appIsPackaged: boolean, envAllowUnsigned: string | undefined): boolean {
  if (appIsPackaged) return false;
  return envAllowUnsigned === "1";
}

// ─── patch zip entry containment (Zip-Slip guard) ────────────────────────────
//
// Used by win-patch-applier BEFORE invoking Expand-Archive. Even though
// PowerShell's Expand-Archive resolves paths under its destination, a
// malicious patch zip could carry entries like `..\..\Windows\system.dll`,
// an absolute `C:\...`, or a UNC `\\host\share\...` path. Validating every
// entry against `destDir` first is belt-and-braces against Zip-Slip.

/**
 * Reject a zip entry name that would escape `destDir` after extraction.
 * Exported for unit testing. Pure (uses only `path`).
 */
export function isUnsafeEntryName(entryName: string, destDir: string): boolean {
  if (!entryName) return true;
  // Normalize backslashes (zip spec uses forward slashes, but a crafted
  // Windows-targeted zip may use backslashes).
  const normalized = entryName.replace(/\\/g, "/");
  // Absolute POSIX path, Windows drive path, or UNC path — never relative.
  if (/^[a-zA-Z]:\//.test(normalized)) return true;
  if (normalized.startsWith("//")) return true;
  if (normalized.startsWith("/")) return true;
  // Reject any segment that is exactly ".." (covers `foo/../../bar`).
  if (normalized.split("/").some((seg) => seg === "..")) return true;
  // Resolve against destDir and require the result stays inside it.
  const resolved = safeResolve(destDir, normalized);
  const rel = safeRelative(destDir, resolved);
  if (!rel || rel === ".." || rel.startsWith(".." + sep()) || isAbsolute(rel)) {
    return true;
  }
  return false;
}

// `path` is imported lazily via require to keep this file usable in environments
// where ESM/CJS interop differs; in the compiled CJS output this is a normal
// require. Wrapping keeps the pure helpers above free of top-level side effects.
import nodePath from "node:path";

function safeResolve(base: string, rel: string): string {
  return nodePath.resolve(base, rel);
}
function safeRelative(base: string, target: string): string {
  return nodePath.relative(base, target);
}
function sep(): string {
  return nodePath.sep;
}
function isAbsolute(p: string): boolean {
  return nodePath.isAbsolute(p);
}
