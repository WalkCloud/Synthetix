/**
 * Long-lived Python daemon client.
 *
 * Replaces per-call `spawn` of `local_chunk.py` (ONNX chunking) and
 * `rag_index.py` (LightRAG indexing) — the two Python steps that run on EVERY
 * document and each paid a full interpreter + heavy-import cold-start. The
 * daemon stays resident across documents (lazy-importing onnx/lightrag only on
 * first use), so chunk + index skip cold-start after the first document.
 *
 * Memory control (the user's primary constraint):
 *  - hosts ONLY chunk + index (~1GB), NOT docling/torch (~2GB) — convert stays
 *    a cache-backed one-shot spawn.
 *  - one in-flight request at a time (serializing mutex) → CPU behavior matches
 *    the existing QUEUE_TOTAL_CONCURRENCY=1.
 *  - idle reaper: kills the daemon after PYTHON_DAEMON_IDLE_TIMEOUT_MS of
 *    inactivity to release RSS; next call respawns.
 *  - RSS guard: if the daemon self-reports above PYTHON_DAEMON_MAX_RSS_MB, it is
 *    restarted between requests (never mid-request — that would orphan an
 *    in-flight index + its .indexing.lock).
 *
 * Wire protocol (newline-delimited JSON) — see workers/python/daemon.py.
 */
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import {
  PYTHON_PATH,
  buildPythonSpawnEnv,
  applyChildPriority,
} from "@/lib/python";

const DAEMON_SCRIPT = path.resolve("workers/python/daemon.py");

const DAEMON_ENABLED = (process.env.PYTHON_DAEMON_ENABLED ?? "true").toLowerCase() !== "false";
const IDLE_TIMEOUT_MS = parsePositiveInt(process.env.PYTHON_DAEMON_IDLE_TIMEOUT_MS, 300_000);
const MAX_RSS_MB = parsePositiveInt(process.env.PYTHON_DAEMON_MAX_RSS_MB, 1500);
// 120s covers interpreter spawn + lighthag/numpy/openai import on slow disks.
// The previous 60s was too tight on Windows where the 340MB ONNX model load
// (now backgrounded in daemon.py) plus lightrag import could exceed it,
// causing Node to SIGKILL the daemon before it ever served a request. Every
// query then paid a full Python cold start (the 28-68s entity-evidence bug).
const STARTUP_TIMEOUT_MS = parsePositiveInt(process.env.PYTHON_DAEMON_STARTUP_TIMEOUT_MS, 120_000);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isDaemonEnabled(): boolean {
  return DAEMON_ENABLED;
}

export type DaemonOp = "chunk" | "index" | "query" | "ping";

export interface DaemonCallOptions {
  onProgressEvent?: (event: Record<string, unknown>) => void;
  onUsageEvent?: (event: Record<string, unknown>) => void;
  timeoutMs?: number;
}

interface InFlight {
  id: number;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  opts: DaemonCallOptions;
  timer: NodeJS.Timeout;
}

export class PythonDaemonClient {
  private child: ChildProcess | null = null;
  private stdoutBuf = "";
  private stderrBuf = "";
  private inFlight: InFlight | null = null;
  private mutex: Promise<void> = Promise.resolve();
  /** True while a daemon request is in-flight (set by gate, cleared on settle). */
  private busy = false;
  private lastActivity = Date.now();
  private reaperTimer: NodeJS.Timeout | null = null;
  private pendingRestart = false;
  private seq = 1;

  /** Serialize callers so the daemon handles one request at a time. */
  private gate<T>(fn: () => Promise<T>, busyFailFast = false): Promise<T> {
    if (busyFailFast && this.busy) {
      // The daemon is busy with another request (typically a long graph index).
      // Rather than blocking the caller up to timeoutMs, reject immediately so
      // it can fall back to an alternative path (e.g. spawn). This keeps query
      // calls responsive during indexing — without fast-fail, a query waits the
      // full daemon timeout (60s) behind the index before falling back to spawn.
      return Promise.reject(new Error("daemon busy"));
    }
    this.busy = true;
    const next = this.mutex.then(fn, fn);
    // Swallow the rejection on the chain link so a failed call never poisons
    // subsequent callers; the original caller still sees the rejection via next.
    this.mutex = next.then(
      () => undefined,
      () => undefined,
    );
    // Clear the busy flag once the request settles so the next caller can proceed.
    next.finally(() => { this.busy = false; });
    return next;
  }

  call<T = Record<string, unknown>>(
    op: DaemonOp,
    params: Record<string, unknown>,
    opts: DaemonCallOptions = {},
  ): Promise<T> {
    // Query calls fast-fail when the daemon is busy (e.g. during a long graph
    // index) so they fall back to spawn immediately instead of blocking 60s.
    const busyFailFast = op === "query";
    return this.gate(async () => {
      this.lastActivity = Date.now();
      try {
        await this.ensureReady();
        return await this.dispatch<T>(op, params, opts);
      } finally {
        // RSS-guard restart happens at a request boundary, never mid-request.
        if (this.pendingRestart) {
          this.pendingRestart = false;
          this.killForRestart();
        }
      }
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.child && this.isAlive()) return;
    await this.spawn();
  }

  private isAlive(): boolean {
    return !!this.child && !this.child.killed && this.child.exitCode === null && this.child.signalCode === null;
  }

  private async spawn(): Promise<void> {
    const env = buildPythonSpawnEnv();
    // Force unbuffered stdio so line-framing works even when the streams are
    // pipes (daemon.py also flushes explicitly — belt and suspenders).
    env.PYTHONUNBUFFERED = "1";

    const child = spawn(PYTHON_PATH, [DAEMON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    this.child = child;

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (d: string) => this.onStdoutData(d));
    child.stderr?.on("data", (d: string) => this.onStderrData(d));
    child.on("exit", (code, sig) => this.onExit(code, sig));
    child.on("error", (err) => {
      // spawn failure (e.g. ENOENT) — surface to any in-flight caller.
      this.child = null;
      this.failInFlight(err);
    });

    if (child.pid) applyChildPriority(child.pid);

    // Handshake: confirm the loop is alive before real calls. ping does NOT
    // trigger any heavy import, so this only measures interpreter readiness.
    // On Windows the first spawn sometimes takes longer than the ping budget
    // (process creation delay, antivirus scan of the new python.exe). Retry
    // once before tearing down — a transiently slow first-spawn shouldn't
    // permanently mark the daemon as failed and force every caller to spawn.
    try {
      await this.dispatch("ping", {}, { timeoutMs: STARTUP_TIMEOUT_MS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on timeout; real errors (spawn ENOENT, script crash) won't
      // be fixed by retrying and would just waste another STARTUP_TIMEOUT_MS.
      const isTimeout = /<timeout after/i.test(msg);
      if (!isTimeout) {
        this.killForRestart();
        throw new Error(`python daemon failed to start: ${msg}`);
      }
      // Tear down the timed-out child and respawn once.
      this.killForRestart();
      try {
        // Re-spawn inline (don't recurse via ensureReady, which would loop).
        const env2 = buildPythonSpawnEnv();
        env2.PYTHONUNBUFFERED = "1";
        const child2 = spawn(PYTHON_PATH, [DAEMON_SCRIPT], {
          stdio: ["pipe", "pipe", "pipe"],
          env: env2,
        });
        this.child = child2;
        child2.stdout?.setEncoding("utf-8");
        child2.stderr?.setEncoding("utf-8");
        child2.stdout?.on("data", (d: string) => this.onStdoutData(d));
        child2.stderr?.on("data", (d: string) => this.onStderrData(d));
        child2.on("exit", (code, sig) => this.onExit(code, sig));
        child2.on("error", (e) => { this.child = null; this.failInFlight(e); });
        if (child2.pid) applyChildPriority(child2.pid);
        await this.dispatch("ping", {}, { timeoutMs: STARTUP_TIMEOUT_MS });
      } catch (retryErr) {
        this.killForRestart();
        throw new Error(`python daemon failed to start (after retry): ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
      }
    }

    this.armReaper();
  }

  /** Send one request line and await its response. Requires a live child. */
  private dispatch<T>(op: DaemonOp, params: Record<string, unknown>, opts: DaemonCallOptions): Promise<T> {
    if (!this.child || !this.child.stdin) {
      return Promise.reject(new Error(`${DAEMON_SCRIPT} failed:\n<daemon not running>`));
    }
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timeout parity: reject with the same shape spawnPythonJson produces
        // so pipeline.ts:504-507's non-blocking catch is unchanged. A timed-out
        // index_document may still hold the loop + .indexing.lock, so force a
        // restart rather than letting a half-finished call linger.
        if (this.inFlight && this.inFlight.id === id) this.inFlight = null;
        this.killForRestart();
        reject(new Error(`${DAEMON_SCRIPT} failed:\n<timeout after ${opts.timeoutMs ?? 120_000}ms>`));
      }, opts.timeoutMs ?? 120_000);

      this.inFlight = {
        id,
        resolve: resolve as (value: unknown) => void,
        reject,
        opts,
        timer,
      };

      try {
        this.child!.stdin!.write(JSON.stringify({ id, op, params }) + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.inFlight = null;
        reject(new Error(`${DAEMON_SCRIPT} failed:\n<write error: ${err instanceof Error ? err.message : String(err)}>`));
      }
    });
  }

  private onStdoutData(d: string): void {
    this.stdoutBuf += d;
    let idx: number;
    while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim();
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      if (!line.startsWith("{")) continue;
      let resp: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        resp = JSON.parse(line);
      } catch {
        continue;
      }
      this.onResponse(resp);
    }
  }

  private onStderrData(d: string): void {
    const lines = (this.stderrBuf + d).split(/\r?\n/);
    this.stderrBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const inflight = this.inFlight;
      // RSS events are handled regardless of an active request (they fire on a
      // timer); progress/usage only matter when a request is open.
      if (ev.type === "rss") {
        this.onRss(Number(ev.rss_mb ?? 0));
        continue;
      }
      if (!inflight) continue;
      if (ev.type === "progress") inflight.opts.onProgressEvent?.(ev);
      else if (ev.type === "usage") inflight.opts.onUsageEvent?.(ev);
    }
  }

  private onResponse(resp: { id?: number; ok?: boolean; result?: unknown; error?: string }): void {
    const inflight = this.inFlight;
    if (!inflight || resp.id !== inflight.id) return; // stale (e.g. arrived after timeout)
    clearTimeout(inflight.timer);
    this.inFlight = null;
    if (resp.ok) {
      inflight.resolve(resp.result);
    } else {
      inflight.reject(new Error(`${DAEMON_SCRIPT} failed:\n${resp.error ?? "unknown daemon error"}`));
    }
  }

  private onExit(code: number | null, sig: NodeJS.Signals | null): void {
    this.child = null;
    if (this.reaperTimer) {
      clearTimeout(this.reaperTimer);
      this.reaperTimer = null;
    }
    this.failInFlight(new Error(`${DAEMON_SCRIPT} failed:\n<daemon exited code=${code} sig=${sig}>`));
  }

  private failInFlight(err: Error): void {
    const inflight = this.inFlight;
    if (!inflight) return;
    clearTimeout(inflight.timer);
    this.inFlight = null;
    inflight.reject(err);
  }

  private onRss(rssMb: number): void {
    if (rssMb <= 0 || rssMb <= MAX_RSS_MB) return;
    // Restart between requests only. If a request is in flight, defer.
    if (!this.inFlight) {
      this.killForRestart();
    } else {
      this.pendingRestart = true;
    }
  }

  private killForRestart(): void {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      /* ignore */
    }
    this.child = null;
    if (this.reaperTimer) {
      clearTimeout(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private armReaper(): void {
    if (this.reaperTimer) clearTimeout(this.reaperTimer);
    const tick = () => {
      if (!this.child) return;
      if (this.inFlight) {
        // Busy — reset lastActivity so an idle window is measured from the last
        // COMPLETED request, not from this in-flight one's start.
        this.lastActivity = Date.now();
        this.reaperTimer = setTimeout(tick, IDLE_TIMEOUT_MS);
        return;
      }
      if (Date.now() - this.lastActivity >= IDLE_TIMEOUT_MS) {
        // Idle long enough — release the resident RSS.
        this.killForRestart();
        return;
      }
      this.reaperTimer = setTimeout(tick, IDLE_TIMEOUT_MS);
    };
    this.reaperTimer = setTimeout(tick, IDLE_TIMEOUT_MS);
  }
}

export const pythonDaemon = new PythonDaemonClient();
