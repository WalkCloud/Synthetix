import { describe, expect, it } from "vitest";
import {
  assertGraphIndexCommitted,
  buildGraphTaskProgressUpdate,
} from "@/lib/queue/workers/document-graph-worker";

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

describe("assertGraphIndexCommitted", () => {
  it("accepts a fully committed index result", () => {
    expect(() => assertGraphIndexCommitted({
      status: "indexed",
      chunks: 2,
      committed_chunks: 2,
      expected_chunks: 2,
    })).not.toThrow();
  });

  it.each([
    undefined,
    { status: "failed", error: "duplicate" },
    { status: "skipped" },
    { status: "indexed", committed_chunks: 1, expected_chunks: 2 },
  ])("rejects an uncommitted graph result", (result) => {
    expect(() => assertGraphIndexCommitted(result)).toThrow();
  });
});
