/**
 * Unit tests for the sidebar update-reminder pure logic.
 *
 * The repo's vitest runs in the `node` environment (no DOM), so we test the
 * pure mapping functions rather than rendering the React component. This
 * covers every UpdateStatus branch the reminder button can see, matching the
 * visibility matrix in
 * docs/online-update-capability-analysis-and-design.md §9.1.
 */
import { describe, it, expect } from "vitest";
import { getReminderState } from "@/lib/update-reminder-state";
import { shouldShowUpdateToast } from "@/lib/update-toast-logic";
import type { UpdateStatus } from "@/types/electron";

describe("getReminderState", () => {
  it("is hidden for idle", () => {
    expect(getReminderState({ kind: "idle" }).visible).toBe(false);
  });

  it("is hidden for checking (don't make noise during a background check)", () => {
    expect(getReminderState({ kind: "checking" }).visible).toBe(false);
  });

  it("is hidden for up-to-date", () => {
    expect(
      getReminderState({
        kind: "up-to-date",
        latestVersion: "1.0.3",
        checkedAt: "2026-07-18T00:00:00Z",
      }).visible,
    ).toBe(false);
  });

  it("is hidden for error (About dialog surfaces errors; no persistent red badge)", () => {
    expect(getReminderState({ kind: "error", message: "boom" }).visible).toBe(false);
  });

  it("shows amber available + open-about for a non-forced update", () => {
    const s = getReminderState({
      kind: "available",
      path: "full",
      version: "1.0.4",
      sizeBytes: 100,
      forced: false,
    });
    expect(s.visible).toBe(true);
    expect(s.variant).toBe("available");
    expect(s.action).toBe("open-about");
    expect(s.labelKey).toBe("sidebarAvailable");
    expect(s.params).toEqual({ version: "1.0.4" });
  });

  it("shows forced variant for a forced update", () => {
    const s = getReminderState({
      kind: "available",
      path: "full",
      version: "1.0.4",
      sizeBytes: 100,
      forced: true,
    });
    expect(s.visible).toBe(true);
    expect(s.variant).toBe("forced");
    expect(s.labelKey).toBe("sidebarMustUpdate");
  });

  it("shows downloading with a progress percent", () => {
    const s = getReminderState({
      kind: "downloading",
      path: "full",
      version: "1.0.4",
      progress: 0.42,
      downloadedBytes: 420,
      totalBytes: 1000,
    });
    expect(s.visible).toBe(true);
    expect(s.variant).toBe("downloading");
    expect(s.progressPct).toBe(42);
    expect(s.params).toEqual({ percent: "42" });
  });

  it("downloading handles zero totalBytes without NaN", () => {
    const s = getReminderState({
      kind: "downloading",
      path: "full",
      version: "1.0.4",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    });
    expect(s.progressPct).toBe(0);
  });

  it("shows ready + install action", () => {
    const s = getReminderState({
      kind: "ready",
      path: "full",
      version: "1.0.4",
      stagedPath: "/tmp/x.exe",
    });
    expect(s.visible).toBe(true);
    expect(s.variant).toBe("ready");
    expect(s.action).toBe("install");
    expect(s.params).toEqual({ version: "1.0.4" });
  });

  it("shows installing as disabled", () => {
    const s = getReminderState({
      kind: "installing",
      path: "full",
      version: "1.0.4",
    });
    expect(s.visible).toBe(true);
    expect(s.disabled).toBe(true);
    expect(s.action).toBe("none");
  });
});

describe("shouldShowUpdateToast", () => {
  it("notifies on the first transition into available", () => {
    const d = shouldShowUpdateToast(
      { kind: "idle" },
      { kind: "available", version: "1.0.4", forced: false },
      new Set(),
    );
    expect(d).toEqual({ notify: true, version: "1.0.4" });
  });

  it("does NOT re-notify on the same version across re-checks", () => {
    const notified = new Set(["1.0.4"]);
    const d = shouldShowUpdateToast(
      { kind: "available", version: "1.0.4", forced: false },
      { kind: "available", version: "1.0.4", forced: false },
      notified,
    );
    expect(d.notify).toBe(false);
  });

  it("notifies for a NEW version even if an older one was notified", () => {
    const notified = new Set(["1.0.4"]);
    const d = shouldShowUpdateToast(
      { kind: "up-to-date" },
      { kind: "available", version: "1.0.5", forced: false },
      notified,
    );
    expect(d).toEqual({ notify: true, version: "1.0.5" });
  });

  it("re-notifies for a forced update even if already notified", () => {
    const notified = new Set(["1.0.4"]);
    const d = shouldShowUpdateToast(
      { kind: "available", version: "1.0.4", forced: true },
      { kind: "available", version: "1.0.4", forced: true },
      notified,
    );
    expect(d).toEqual({ notify: true, version: "1.0.4" });
  });

  it("does not notify on transitions into non-available states", () => {
    const cases: UpdateStatus[] = [
      { kind: "idle" },
      { kind: "checking" },
      { kind: "up-to-date", latestVersion: "1.0.4", checkedAt: "x" },
      { kind: "downloading", path: "full", version: "1.0.4", progress: 0.1, downloadedBytes: 1, totalBytes: 10 },
      { kind: "installing", path: "full", version: "1.0.4" },
      { kind: "error", message: "x" },
    ];
    for (const next of cases) {
      const d = shouldShowUpdateToast({ kind: "idle" }, next, new Set());
      expect(d.notify).toBe(false);
    }
  });

  it("notifies on transition into ready (user wasn't around for available)", () => {
    const d = shouldShowUpdateToast(
      { kind: "idle" },
      { kind: "ready", version: "1.0.4" },
      new Set(),
    );
    expect(d).toEqual({ notify: true, version: "1.0.4" });
  });

  it("does not notify when an available status lacks a version", () => {
    const d = shouldShowUpdateToast(
      { kind: "idle" },
      { kind: "available", version: undefined as unknown as string, forced: false },
      new Set(),
    );
    expect(d.notify).toBe(false);
  });
});
