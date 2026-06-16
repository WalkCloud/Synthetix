import { describe, expect, it, vi } from "vitest";
import { createOnceRecorder } from "@/lib/writing/once-recorder";

describe("createOnceRecorder", () => {
  it("invokes the underlying function exactly once even when record() is called multiple times", async () => {
    const fn = vi.fn(async () => {});
    const r = createOnceRecorder(fn);
    await r.record();
    await r.record();
    await r.record();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("marks itself recorded synchronously before invoking the underlying function", async () => {
    let resolveInner!: () => void;
    const fn = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveInner = res;
        }),
    );
    const r = createOnceRecorder(fn);
    const first = r.record();
    // While the first invocation is still pending, a second call must early-exit.
    const second = r.record();
    resolveInner();
    await Promise.all([first, second]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("still records once when the previous attempt threw", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = createOnceRecorder(fn);
    await expect(r.record()).rejects.toThrow("boom");
    // Subsequent calls do NOT retry — recording is best-effort + idempotent.
    await r.record();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
