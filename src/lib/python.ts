import { spawn } from "child_process";
import os from "os";

export interface PythonSpawnOptions {
  timeout?: number;
  parseJson?: boolean;
  onProgressEvent?: (event: Record<string, unknown>) => void;
  onUsageEvent?: (event: Record<string, unknown>) => void;
  /** Additional environment variables merged into the child's env (for secrets). */
  env?: Record<string, string>;
  /** AbortSignal for cooperative cancellation. When aborted, the child process
   * tree is terminated (taskkill /T /F on Windows, process-group kill on POSIX)
   * and the promise rejects only after the child's close event fires. */
  signal?: AbortSignal;
}

export const PYTHON_PATH = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");

const THREAD_LIMIT_RAW = Number.parseInt(process.env.PYTHON_THREAD_LIMIT || "2", 10);
const THREAD_LIMIT = String(Number.isFinite(THREAD_LIMIT_RAW) && THREAD_LIMIT_RAW > 0 ? THREAD_LIMIT_RAW : 2);

let priorityWarned = false;

export function resolvePriority(): number | null {
  const raw = (process.env.PYTHON_PRIORITY || "below_normal").toLowerCase();
  if (raw === "off" || raw === "disabled" || raw === "default") return null;
  if (raw === "normal") return os.constants.priority.PRIORITY_NORMAL;
  if (raw === "idle" || raw === "low") return os.constants.priority.PRIORITY_LOW;
  if (raw === "below_normal" || raw === "below-normal") return os.constants.priority.PRIORITY_BELOW_NORMAL;
  return os.constants.priority.PRIORITY_BELOW_NORMAL;
}

/**
 * Build the env dict passed to every Python child. Caps intra-process thread
 * pools so a single Python child cannot saturate every core — each native lib
 * reads its OWN env var, so we set them all. Shared by the one-shot
 * `spawnPython` path and the long-lived `pythonDaemon` client so the two paths
 * can never drift.
 */
export function buildPythonSpawnEnv(): NodeJS.ProcessEnv {
  const spawnEnv = {
    ...process.env,
    PYTHONUTF8: "1",
    ORT_DISABLE_ALL: process.env.ORT_DISABLE_ALL || "1",
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || THREAD_LIMIT,
    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || THREAD_LIMIT,
    OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || THREAD_LIMIT,
    NUMEXPR_NUM_THREADS: process.env.NUMEXPR_NUM_THREADS || THREAD_LIMIT,
    ORT_NUM_THREADS: process.env.ORT_NUM_THREADS || THREAD_LIMIT,
    TORCH_NUM_THREADS: process.env.TORCH_NUM_THREADS || THREAD_LIMIT,
    TORCH_NUM_INTEROP_THREADS: process.env.TORCH_NUM_INTEROP_THREADS || "1",
    TOKENIZERS_PARALLELISM: process.env.TOKENIZERS_PARALLELISM || "false",
  } as NodeJS.ProcessEnv;
  if (process.env.LOCAL_EMBED_MODEL_PATH) spawnEnv.LOCAL_EMBED_MODEL_PATH = process.env.LOCAL_EMBED_MODEL_PATH;
  return spawnEnv;
}

/**
 * Lower a child's scheduling priority so the Next.js process keeps the UI
 * responsive even while Python is at 100% (Windows → SetPriorityClass).
 * Best-effort: locked-down envs deny this — warn once and continue. Shared by
 * `spawnPython` and `pythonDaemon` for parity.
 */
export function applyChildPriority(pid: number): void {
  const prio = resolvePriority();
  if (prio === null) return;
  try {
    os.setPriority(pid, prio);
  } catch (err) {
    if (!priorityWarned) {
      priorityWarned = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[python] os.setPriority failed (continuing at default priority): ${msg}`);
    }
  }
}

export function spawnPython(
  script: string,
  args: string[],
  options: PythonSpawnOptions = {}
): Promise<string> {
  const { timeout = 120_000, parseJson = true, onProgressEvent, onUsageEvent, signal } = options;

  const spawnEnv = buildPythonSpawnEnv();
  // Merge caller-provided env (for secrets that must not appear in argv).
  if (options.env) Object.assign(spawnEnv, options.env);

  return new Promise((resolve, reject) => {
    // Use detached process group on POSIX so we can kill the entire tree.
    // On Windows we use taskkill /T /F which doesn't need detached.
    const isWindows = process.platform === "win32";
    const proc = spawn(PYTHON_PATH, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
      detached: !isWindows, // POSIX: create a new process group for tree kill
    });

    if (proc.pid) applyChildPriority(proc.pid);

    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationReason: "timeout" | "abort" | null = null;

    /** Terminate the entire process tree and wait for close. Called once. */
    const terminateTree = (reason: "timeout" | "abort") => {
      if (terminationReason !== null) return; // already terminating
      terminationReason = reason;
      if (!proc.pid) return;
      try {
        if (isWindows) {
          // taskkill /T kills the entire process tree; /F forces.
          spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
            stdio: "ignore", windowsHide: true,
          });
        } else {
          // Kill the entire process group (negative PID).
          try { process.kill(-proc.pid, "SIGTERM"); } catch {}
        }
      } catch {
        // Best-effort; the close handler will still fire.
      }
    };

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    let stderrTail = "";
    proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      if (!onProgressEvent && !onUsageEvent) return;

      const lines = (stderrTail + text).split(/\r?\n/);
      stderrTail = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          if (event.type === "progress" && onProgressEvent) onProgressEvent(event);
          else if (event.type === "usage" && onUsageEvent) onUsageEvent(event);
        } catch {}
      }
    });

    // Timeout: self-managed (not relying on spawn's built-in timeout which
    // only sends SIGTERM without tree kill on Windows).
    const timeoutHandle = setTimeout(() => {
      terminateTree("timeout");
    }, timeout);

    // Abort signal: terminate the tree when the caller cancels.
    const onAbort = () => {
      terminateTree("abort");
    };
    if (signal) {
      if (signal.aborted) {
        terminateTree("abort");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationReason === "timeout") {
        reject(new Error(`${script} timed out after ${timeout}ms`));
        return;
      }
      if (terminationReason === "abort") {
        reject(new Error(`${script} was cancelled`));
        return;
      }
      if (code !== 0) {
        const detail = [stderr, stdout].filter(Boolean).join("\n") || `code ${code}`;
        reject(new Error(`${script} failed:\n${detail}`));
        return;
      }
      if (!parseJson) {
        resolve(stdout.trim());
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) { resolve("{}"); return; }
      try {
        JSON.parse(trimmed);
        resolve(trimmed);
      } catch {
        reject(new Error(`${script} returned invalid JSON: ${trimmed.slice(0, 500)}`));
      }
    });

    proc.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
  });
}

export function spawnPythonJson<T = Record<string, unknown>>(
  script: string,
  args: string[],
  options: Omit<PythonSpawnOptions, "parseJson"> = {}
): Promise<T> {
  return spawnPython(script, args, { ...options, parseJson: true }).then(
    (raw) => JSON.parse(raw) as T
  );
}
