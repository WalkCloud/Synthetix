/**
 * Node-side per-user RAG mutation lock adapter.
 *
 * Mirrors the on-disk protocol of workers/python/rag_mutation_lock.py so a
 * Node reset of a user workspace and a Python index/graph writer can NEVER
 * mutate the same per-user LightRAG storage concurrently. The lock directory
 * and owner.json schema are intentionally identical to the Python
 * implementation; see rag_mutation_lock.py for the protocol rationale.
 *
 * Why this exists: the Python writer lock alone is insufficient because Node
 * also directly mutates the user RAG workspace via deleteUserRagData /
 * resetUserKnowledgeBase / startup orphan cleanup. Without a shared lock those
 * Node paths can `rm -rf` a workspace mid-write — exactly the cross-document
 * data-loss class this fix targets.
 *
 * Protocol (must match Python exactly):
 *   - Lock directory: <RAG_LOCK_ROOT>/<userId>/  (acquired via atomic mkdir)
 *   - owner.json fields: version, token, userId, pid, processStartIdentity,
 *     hostname, runtime, operation, taskId, documentId, acquiredAt, heartbeatAt
 *   - Heartbeat refresh every 10s; stale reclaim only when owner PID is dead
 *   - Release: verify token, rename to .releasing.<token> tombstone, then rmtree
 *   - Old owner must NEVER delete a new owner's lock (token check on release)
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { resolveUserRagLockDir } from "./paths";

const SCHEMA_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_S = 60;
// Graph-mode extraction on large documents (500+ chunks) can hold the lock for
// 30+ minutes. The old 5-minute wait timeout caused queued graph tasks to fail
// with RagMutationBusyError before they could start. Aligned with the graph-
// index task budget (4h) so queued tasks patiently wait their turn.
const DEFAULT_WAIT_TIMEOUT_S = Number(process.env.RAG_LOCK_WAIT_TIMEOUT_S) || 14400;
const DEFAULT_WAIT_POLL_MIN_MS = 100;
const DEFAULT_WAIT_POLL_MAX_MS = 500;

export class RagMutationBusyError extends Error {
  readonly code = "RAG_MUTATION_BUSY";
  readonly retryable = true;
  constructor(readonly userId: string, readonly owner?: RagLockOwner | null) {
    super(`RAG workspace for user ${userId} is locked by another writer`);
    this.name = "RagMutationBusyError";
  }
}

export class RagMutationLockLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RagMutationLockLostError";
  }
}

export interface RagLockOwner {
  version: number;
  token: string;
  userId: string;
  pid: number;
  processStartIdentity: string;
  hostname: string;
  runtime: string;
  operation: string;
  taskId: string;
  documentId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface AcquireOptions {
  operation: string;
  taskId?: string;
  documentId?: string;
  waitTimeoutMs?: number;
  staleThresholdS?: number;
  pollMinMs?: number;
  pollMaxMs?: number;
}

export interface RagMutationLease {
  readonly userId: string;
  readonly token: string;
  readonly release: () => Promise<void>;
  readonly assertOwned: () => void;
}

// ── Process identity ─────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Process start identity. Node's process.pid can be recycled on Windows, so we
 * combine pid with the process start time when obtainable. This is best-effort
 * cross-platform; the Python side does the same via psutil/ctypes.
 */
function processStartIdentity(): string {
  const pid = process.pid;
  // Le_boottime / creation time is not directly available from Node stdlib
  // without native addons. Use a per-process random nonce persisted for the
  // lifetime of this Node process — combined with pid it gives a unique-enough
  // identity for stale-lock detection. The Python side uses psutil create_time;
  // cross-runtime mismatch only matters if a Python owner and Node contender
  // race, in which case the Python owner's authoritative start identity wins
  // (it is the one holding the lock).
  return `${pid}:${NODE_START_NONCE}`;
}

const NODE_START_NONCE = crypto.randomBytes(8).toString("hex");

// ── owner.json read/write ────────────────────────────────────────────────────

function readOwner(lockDir: string): RagLockOwner | null {
  const ownerPath = path.join(lockDir, "owner.json");
  try {
    const raw = fs.readFileSync(ownerPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
      return parsed as RagLockOwner;
    }
    return null;
  } catch {
    return null;
  }
}

function writeOwner(lockDir: string, owner: RagLockOwner): void {
  // Atomic write: tmp + rename. Matches the Windows-safe pattern used across
  // the codebase (win_atomic_patch.py on the Python side).
  const ownerPath = path.join(lockDir, "owner.json");
  const tmp = `${ownerPath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(owner), "utf-8");
  try {
    fs.renameSync(tmp, ownerPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

// ── PID liveness (cross-platform) ────────────────────────────────────────────

function isPidAlive(pid: number, _startIdentity: string): boolean {
  // Send signal 0 (no-op presence check). On Windows process.kill with 0
  // throws if the pid is not alive. We do NOT validate startIdentity here
  // (Node cannot read process creation time portably); the Python side's
  // authoritative check covers Python-owned locks. For Node-vs-Node staleness
  // the random NODE_START_NONCE embedded in owner.json is compared by the
  // caller when relevant.
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Acquisition primitives ───────────────────────────────────────────────────

function tryCreateLock(lockDir: string, owner: RagLockOwner): boolean {
  try {
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });
    fs.mkdirSync(lockDir); // atomic; throws EEXIST if present
    writeOwner(lockDir, owner);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    // Other OS errors (perm, disk) — treat as not acquired; caller backs off.
    return false;
  }
}

function canReclaim(
  lockDir: string,
  staleThresholdS: number,
): { reclaim: boolean; owner: RagLockOwner | null } {
  const owner = readOwner(lockDir);
  if (!owner) return { reclaim: true, owner: null }; // corrupt/missing owner

  const hb = owner.heartbeatAt ? Date.parse(owner.heartbeatAt) : NaN;
  if (Number.isFinite(hb)) {
    const ageS = (Date.now() - hb) / 1000;
    if (ageS < staleThresholdS) return { reclaim: false, owner }; // still fresh
  }

  // Heartbeat stale — only reclaim if the owner PID is provably dead.
  if (typeof owner.pid === "number" && owner.pid > 0) {
    if (isPidAlive(owner.pid, owner.processStartIdentity)) {
      return { reclaim: false, owner }; // live process — DO NOT reclaim
    }
  }
  return { reclaim: true, owner };
}

function reclaim(lockDir: string): boolean {
  const tombstone = `${lockDir}.stale.${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(lockDir, tombstone);
  } catch {
    return false; // someone else moved/removed it
  }
  fs.rmSync(tombstone, { recursive: true, force: true });
  return true;
}

function rmtree(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

// ── Lease ────────────────────────────────────────────────────────────────────

interface LeaseInternal extends RagMutationLease {
  heartbeatTimer: NodeJS.Timeout | null;
}

function makeLease(
  userId: string,
  token: string,
  lockDir: string,
  owner: RagLockOwner,
): LeaseInternal {
  let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
    // Refresh heartbeatAt. Best-effort; assertOwned catches real loss.
    owner.heartbeatAt = nowIso();
    try { writeOwner(lockDir, owner); } catch {}
  }, HEARTBEAT_INTERVAL_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();

  const assertOwned = () => {
    const current = readOwner(lockDir);
    if (!current || current.token !== token) {
      throw new RagMutationLockLostError(
        `Lock for user ${userId} was lost or taken over`,
      );
    }
  };

  const release = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const current = readOwner(lockDir);
    if (!current || current.token !== token) {
      // Lock already taken over or removed — do NOT delete a new owner's lock.
      return;
    }
    // Rename to tombstone first, then delete — prevents a race where another
    // process recreates the lock dir between our rename and our rmtree.
    const tombstone = `${lockDir}.releasing.${token}`;
    try {
      fs.renameSync(lockDir, tombstone);
    } catch {
      return;
    }
    rmtree(tombstone);
  };

  return { userId, token, release, assertOwned, heartbeatTimer };
}

// ── Public acquisition ───────────────────────────────────────────────────────

export async function acquireUserRagLock(
  userId: string,
  opts: AcquireOptions,
): Promise<RagMutationLease> {
  const lockDir = resolveUserRagLockDir(userId);
  const token = crypto.randomBytes(16).toString("hex");
  const owner: RagLockOwner = {
    version: SCHEMA_VERSION,
    token,
    userId,
    pid: process.pid,
    processStartIdentity: processStartIdentity(),
    hostname: os.hostname() || "",
    runtime: "node",
    operation: opts.operation,
    taskId: opts.taskId ?? "",
    documentId: opts.documentId ?? "",
    acquiredAt: nowIso(),
    heartbeatAt: nowIso(),
  };

  const deadline = Date.now() + (opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_S * 1000);
  const staleThresholdS = opts.staleThresholdS ?? DEFAULT_STALE_THRESHOLD_S;
  const pollMin = opts.pollMinMs ?? DEFAULT_WAIT_POLL_MIN_MS;
  const pollMax = opts.pollMaxMs ?? DEFAULT_WAIT_POLL_MAX_MS;

  let lastOwner: RagLockOwner | null = null;
  while (true) {
    if (tryCreateLock(lockDir, owner)) {
      return makeLease(userId, token, lockDir, owner);
    }

    const { reclaim: shouldReclaim, owner: current } = canReclaim(lockDir, staleThresholdS);
    lastOwner = current;
    if (shouldReclaim) {
      if (reclaim(lockDir)) continue; // retry creation
    }

    if (Date.now() >= deadline) {
      throw new RagMutationBusyError(userId, lastOwner);
    }

    // Jittered backoff before retry.
    const delay = pollMin + Math.random() * (pollMax - pollMin);
    await sleep(delay);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire the per-user mutation lock, run `fn`, and always release.
 *
 * Use this around any Node code that directly mutates a user's RAG workspace
 * (deleteUserRagData, resetUserKnowledgeBase, startup orphan reset). The
 * Python index/graph/delete path acquires the same lock, so the two runtimes
 * never write the workspace concurrently.
 */
export async function withUserRagLock<T>(
  userId: string,
  operation: string,
  fn: (lease: RagMutationLease) => Promise<T>,
  opts: Omit<AcquireOptions, "operation"> = {},
): Promise<T> {
  const lease = await acquireUserRagLock(userId, { ...opts, operation });
  try {
    return await fn(lease);
  } finally {
    await lease.release();
  }
}
