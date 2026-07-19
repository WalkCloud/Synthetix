import { describe, expect, it } from "vitest";
import { getProcessingTimeFields } from "@/app/(dashboard)/library/[id]/page";

describe("getProcessingTimeFields", () => {
  it.each([
    { mode: "graph", totalMs: 120_000, basicMs: 30_000 },
    { mode: "wiki", totalMs: 180_000, basicMs: 40_000 },
    { mode: "full", totalMs: 240_000, basicMs: 50_000 },
  ])("shows the $mode total duration instead of the basic duration", ({ totalMs, basicMs }) => {
    const fields = getProcessingTimeFields({
      status: "ready",
      processingDurationMs: totalMs,
      basicDurationMs: basicMs,
      liveElapsedMs: null,
    });

    expect(fields).toEqual([{ durationMs: totalMs, inProgress: false }]);
  });

  it.each(["ready", "enhancing", "finished"])(
    "renders only one processing-time field for %s documents",
    (status) => {
      const fields = getProcessingTimeFields({
        status,
        processingDurationMs: 120_000,
        basicDurationMs: 30_000,
        liveElapsedMs: null,
      });

      expect(fields).toHaveLength(1);
      expect(fields[0]?.durationMs).toBe(120_000);
    },
  );

  it("keeps one processing-time field while enhancement total is still pending", () => {
    expect(getProcessingTimeFields({
      status: "enhancing",
      processingDurationMs: null,
      basicDurationMs: 30_000,
      liveElapsedMs: null,
    })).toEqual([{ durationMs: null, inProgress: true }]);
  });

  it("uses the live elapsed duration while processing", () => {
    expect(getProcessingTimeFields({
      status: "processing",
      processingDurationMs: null,
      basicDurationMs: null,
      liveElapsedMs: 45_000,
    })).toEqual([{ durationMs: 45_000, inProgress: true }]);
  });
});
