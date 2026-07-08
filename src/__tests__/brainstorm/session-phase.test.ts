import { describe, expect, it } from "vitest";
import { inferSessionPhase, type OutlineTaskLike } from "@/lib/brainstorm/session-phase";

const SID = "session-1";

function task(status: OutlineTaskLike["status"], sessionId: string | null = SID): OutlineTaskLike {
  return { sessionId, status };
}

describe("inferSessionPhase", () => {
  it("returns 'ready' when an outline already exists", () => {
    expect(inferSessionPhase(true, [], SID)).toBe("ready");
  });

  it("returns 'ready' when an outline exists even if there are failed tasks", () => {
    expect(inferSessionPhase(true, [task("failed")], SID)).toBe("ready");
  });

  it("returns 'ready' when a pending outline_generate task exists", () => {
    expect(inferSessionPhase(false, [task("pending")], SID)).toBe("ready");
  });

  it("returns 'ready' when a running outline_generate task exists", () => {
    expect(inferSessionPhase(false, [task("running")], SID)).toBe("ready");
  });

  // The regression this module exists to fix: a failed outline task used to
  // leave the session stuck at "gathering" on reload, with no UI path to
  // regenerate. It must recover to "ready" so the failed/retry panel renders.
  it("returns 'ready' when the only matching task is failed", () => {
    expect(inferSessionPhase(false, [task("failed")], SID)).toBe("ready");
  });

  it("returns 'gathering' when the only matching task is cancelled (no active/failed)", () => {
    expect(inferSessionPhase(false, [task("cancelled")], SID)).toBe("gathering");
  });

  it("returns 'gathering' when there are no tasks at all", () => {
    expect(inferSessionPhase(false, [], SID)).toBe("gathering");
  });

  it("prefers an active task over a failed one (pending + failed → ready)", () => {
    expect(inferSessionPhase(false, [task("failed"), task("pending")], SID)).toBe("ready");
  });

  it("ignores tasks that belong to a different session", () => {
    const otherSessionTasks: OutlineTaskLike[] = [
      task("failed", "other-session"),
      task("pending", "other-session"),
    ];
    expect(inferSessionPhase(false, otherSessionTasks, SID)).toBe("gathering");
  });

  it("ignores a completed task that has no outline (treats as gathering)", () => {
    // A completed task without a stored outline is a degenerate case; we don't
    // want to show "ready" (nothing to show) — gathering is the safe fallback.
    expect(inferSessionPhase(false, [task("completed")], SID)).toBe("gathering");
  });
});
