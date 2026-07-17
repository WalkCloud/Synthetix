/**
 * Canonical RAG path resolution shared by Node and (via env vars) Python.
 *
 * All RAG data lives under RAG_ROOT. The mutation lock lives under
 * RAG_LOCK_ROOT — deliberately OUTSIDE the per-user RAG directory so that
 * a workspace reset cannot delete an active lock.
 *
 * In packaged (Electron) operation, electron/main.ts sets both env vars to
 * absolute paths under the user data directory. In development they default
 * to ./data/rag and ./data/locks/rag relative to cwd.
 *
 * userId is validated as a single path segment to prevent directory traversal.
 * Python workers read the same env vars (see rag_common.resolve_rag_root).
 */
import os from "os";
import path from "path";

function defaultDataRoot(): string {
  // Mirror src/lib/db-path.ts: DB_PATH or ~/synthetix-data in packaged mode,
  // but during dev (no DB_PATH) the relative ./data is used by convention.
  return process.env.DB_PATH || path.join(os.homedir(), "synthetix-data");
}

/** Absolute root directory for all per-user RAG workspaces. */
export function resolveRagRoot(): string {
  const root = process.env.RAG_ROOT || path.join("data", "rag");
  return path.resolve(root);
}

/**
 * Absolute root directory for per-user RAG mutation locks.
 *
 * Defaults to a sibling of RAG_ROOT (not inside it) so that resetting a
 * user workspace never erases an active lock.
 */
export function resolveRagLockRoot(): string {
  const lockRoot = process.env.RAG_LOCK_ROOT;
  if (lockRoot) return path.resolve(lockRoot);
  // Default: <ragRoot>/../locks/rag — outside the resettable workspace tree.
  const ragRoot = resolveRagRoot();
  return path.resolve(ragRoot, "..", "locks", "rag");
}

/**
 * Validate that userId is a single, safe path segment.
 * Rejects separators, traversal, empty strings, and NUL bytes.
 */
function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string") {
    throw new Error("userId must be a non-empty string");
  }
  if (
    userId.includes("/") ||
    userId.includes("\\") ||
    userId.includes("..") ||
    userId.includes("\0") ||
    userId.includes(path.sep)
  ) {
    throw new Error(`userId contains illegal path characters: ${JSON.stringify(userId)}`);
  }
}

/** Absolute per-user RAG workspace directory. */
export function resolveUserRagDir(userId: string): string {
  validateUserId(userId);
  return path.join(resolveRagRoot(), userId);
}

/** Absolute per-user lock directory path (the directory that mkdir acquires). */
export function resolveUserRagLockDir(userId: string): string {
  validateUserId(userId);
  return path.join(resolveRagLockRoot(), userId);
}
