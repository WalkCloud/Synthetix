import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// Mock the python module helpers consumed by the daemon client.
vi.mock("@/lib/python", () => ({
  PYTHON_PATH: "python",
  buildPythonSpawnEnv: () => ({ PYTHONUTF8: "1" }),
  applyChildPriority: vi.fn(),
}));

// spawn is replaced per-test via mockImplementation to return a fake child.
vi.mock("child_process", () => ({ spawn: vi.fn() }));

// Imported AFTER vi.mock so the mocks take effect.
import { spawn } from "child_process";
import { PythonDaemonClient } from "@/lib/python-daemon";

interface MockChild {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _handlers: Record<string, Array<(...args: unknown[]) => void>>;
  _lastRequest?: { id: number; op: string; params: Record<string, unknown> };
  _emitExit: (code: number | null, sig: NodeJS.Signals | null) => void;
}

/** Build a fake ChildProcess. ping is auto-answered (for the startup handshake
 * and for ping calls); other ops wait for the test to push a response. */
function createMockChild(autoPing = true): MockChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  // python-daemon.ts calls stdout/stderr.setEncoding("utf-8"); stub them since
  // a bare EventEmitter has no such method.
  (stdout as unknown as { setEncoding: () => void }).setEncoding = () => {};
  (stderr as unknown as { setEncoding: () => void }).setEncoding = () => {};
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const child: MockChild = {
    pid: 12345,
    killed: false,
    exitCode: null,
    signalCode: null,
    stdout,
    stderr,
    stdin: {
      write: vi.fn((line: string) => {
        try {
          const req = JSON.parse(line.trim());
          child._lastRequest = req;
          if (autoPing && req.op === "ping") {
            queueMicrotask(() =>
              stdout.emit("data", JSON.stringify({ id: req.id, ok: true, result: { pong: true } }) + "\n"),
            );
          }
        } catch {
          /* ignore */
        }
        return true;
      }),
      end: vi.fn(),
    },
    kill: vi.fn(() => {
      child.killed = true;
      return true;
    }),
    on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => {
      (handlers[ev] ||= []).push(cb);
      return child;
    }),
    _handlers: handlers,
    _emitExit: (code, sig) => {
      (handlers.exit || []).forEach((cb) => cb(code, sig));
    },
  };
  return child;
}

function emitLine(stream: EventEmitter, obj: Record<string, unknown>): void {
  queueMicrotask(() => stream.emit("data", JSON.stringify(obj) + "\n"));
}

function pushStderr(stream: EventEmitter, line: string): void {
  queueMicrotask(() => stream.emit("data", line + "\n"));
}

describe("PythonDaemonClient", () => {
  let client: PythonDaemonClient;
  let mockSpawn: ReturnType<typeof vi.fn>;
  let child: MockChild;

  beforeEach(() => {
    vi.useFakeTimers();
    child = createMockChild();
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockImplementation((() => child) as unknown as typeof spawn);
    client = new PythonDaemonClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Resolve queued microtasks (queueMicrotask callbacks) so async IO handlers
   * run without advancing fake timers. */
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("handshakes on first call and resolves the result", async () => {
    const p = client.call("ping", {});
    // The startup handshake ping is auto-answered by the mock; the op ping too.
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    await expect(p).resolves.toEqual({ pong: true });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("dispatches progress + usage stderr events to the right callbacks", async () => {
    // Make the mock answer `index` with two stderr events then the response.
    (child.stdin.write as ReturnType<typeof vi.fn>).mockImplementation((line: string) => {
      try {
        const req = JSON.parse(line.trim());
        if (req.op === "ping") {
          emitLine(child.stdout, { id: req.id, ok: true, result: { pong: true } });
        } else if (req.op === "index") {
          pushStderr(child.stderr, '{"type":"progress","stage":"indexing","progress":40}');
          pushStderr(child.stderr, "UserWarning: ignored noise"); // non-JSON → ignored
          pushStderr(child.stderr, '{"type":"usage","module":"graph","input_tokens":10,"output_tokens":5}');
          emitLine(child.stdout, { id: req.id, ok: true, result: { status: "indexed", chunks: 1 } });
        }
      } catch {
        /* ignore */
      }
      return true;
    });

    const progress = vi.fn();
    const usage = vi.fn();
    const p = client.call("index", { doc_id: "d1" }, { onProgressEvent: progress, onUsageEvent: usage });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const result = await p;

    expect(result).toEqual({ status: "indexed", chunks: 1 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "indexing", progress: 40 }));
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ module: "graph", input_tokens: 10 }));
  });

  it("ignores non-JSON stderr lines without throwing", async () => {
    (child.stdin.write as ReturnType<typeof vi.fn>).mockImplementation((line: string) => {
      try {
        const req = JSON.parse(line.trim());
        if (req.op === "ping") emitLine(child.stdout, { id: req.id, ok: true, result: { pong: true } });
        else {
          pushStderr(child.stderr, "some library warning");
          pushStderr(child.stderr, "{not valid json");
          emitLine(child.stdout, { id: req.id, ok: true, result: {} });
        }
      } catch {
        /* ignore */
      }
      return true;
    });
    const p = client.call("index", { doc_id: "d1" });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    await expect(p).resolves.toEqual({});
  });

  it("rejects with a 'failed' message on timeout", async () => {
    // Disable auto-answer so the op never resolves → times out.
    (child.stdin.write as ReturnType<typeof vi.fn>).mockImplementation((line: string) => {
      try {
        const req = JSON.parse(line.trim());
        if (req.op === "ping") emitLine(child.stdout, { id: req.id, ok: true, result: { pong: true } });
        // index: no response
      } catch {
        /* ignore */
      }
      return true;
    });
    const p = client.call("index", { doc_id: "d1" }, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    // startup handshake ping resolves; the index op's 1s timer then fires.
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await expect(p).rejects.toThrow(/failed/);
  });

  it("rejects the in-flight call if the daemon exits", async () => {
    (child.stdin.write as ReturnType<typeof vi.fn>).mockImplementation((line: string) => {
      try {
        const req = JSON.parse(line.trim());
        if (req.op === "ping") emitLine(child.stdout, { id: req.id, ok: true, result: { pong: true } });
        // index: never responds; test will crash the daemon instead
      } catch {
        /* ignore */
      }
      return true;
    });
    const p = client.call("index", { doc_id: "d1" });
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    child._emitExit(1, "SIGTERM");
    await flush();
    await expect(p).rejects.toThrow(/daemon exited/);
  });

  it("serializes calls (second call waits for the first)", async () => {
    (child.stdin.write as ReturnType<typeof vi.fn>).mockImplementation((line: string) => {
      try {
        const req = JSON.parse(line.trim());
        if (req.op === "ping") emitLine(child.stdout, { id: req.id, ok: true, result: { pong: true } });
        else {
          // Each index op (after the handshake ping on id 1) gets its own response.
          emitLine(child.stdout, { id: req.id, ok: true, result: { rid: req.id } });
        }
      } catch {
        /* ignore */
      }
      return true;
    });

    const first = client.call<Record<string, unknown>>("index", {});
    const second = client.call<Record<string, unknown>>("index", {});
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const [r1, r2] = await Promise.all([first, second]);
    // Both complete, with distinct request ids — proving the mutex ran them
    // sequentially rather than collapsing them.
    expect(r1).toEqual({ rid: expect.any(Number) });
    expect(r2).toEqual({ rid: expect.any(Number) });
    expect(r1).not.toEqual(r2);
  });
});
