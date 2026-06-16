import { describe, expect, it } from "vitest";
import { buildGraphTaskProgressUpdate } from "@/lib/queue/workers/document-graph-worker";

describe("buildGraphTaskProgressUpdate", () => {
  it("converts Python progress events into async task updates", () => {
    const update = buildGraphTaskProgressUpdate(
      { type: "progress", stage: "indexing", progress: 55, message: "Extracting entities", processed: 5, total: 20 },
      new Date("2026-06-08T00:00:00.000Z"),
    );

    expect(update.progress).toBe(55);
    expect(JSON.parse(update.resultData)).toEqual({
      stage: "indexing",
      message: "Extracting entities",
      processed: 5,
      total: 20,
      lastHeartbeatAt: "2026-06-08T00:00:00.000Z",
    });
  });
});
