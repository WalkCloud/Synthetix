import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { spawn } from "child_process";

// Mock child_process.spawn so we can simulate a long-running child and
// verify that abort triggers tree termination and waits for close.
const mockChild = new EventEmitter() as any;
mockChild.pid = 12345;
mockChild.stdout = new EventEmitter();
mockChild.stderr = new EventEmitter();
mockChild.kill = vi.fn();

const spawnMock = vi.fn((_cmd, _args, _opts) => mockChild);
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import after mock is set up.
const { spawnPython } = await import("@/lib/python");

describe("spawnPython cancellation", () => {
  it("rejects with cancellation error after close when signal aborts", async () => {
    const controller = new AbortController();
    const promise = spawnPython("test_script.py", [], {
      timeout: 60_000,
      signal: controller.signal,
    });

    // Give the promise a tick to register listeners.
    await new Promise((r) => setTimeout(r, 10));

    // Abort should trigger tree termination.
    controller.abort();

    // The promise should still be pending — we haven't emitted close yet.
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    // Now emit close — promise should reject with cancellation message.
    mockChild.emit("close", 1);
    await expect(promise).rejects.toThrow(/cancelled/);
  });

  it("rejects with timeout error after close when timeout fires", async () => {
    const promise = spawnPython("test_script.py", [], { timeout: 50 });

    // Wait for timeout to fire.
    await new Promise((r) => setTimeout(r, 80));

    // Emit close — should reject with timeout.
    mockChild.emit("close", 1);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("resolves normally when child exits 0 with valid JSON", async () => {
    const p = spawnPython("test_script.py", [], { timeout: 5000 });
    mockChild.stdout.emit("data", Buffer.from('{"status":"ok"}'));
    mockChild.emit("close", 0);
    await expect(p).resolves.toBe('{"status":"ok"}');
  });
});
