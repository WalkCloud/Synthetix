import { describe, expect, it } from "vitest";
import { buildConvertTaskProgressUpdate } from "@/lib/queue/workers/document-convert-worker";

describe("buildConvertTaskProgressUpdate", () => {
  it("maps convert progress events into task progress resultData", () => {
    const update = buildConvertTaskProgressUpdate(
      { stage: "docling_convert", progress: 25, message: "Converting document with Docling" },
      new Date("2026-06-27T08:00:00.000Z"),
    );

    expect(update.progress).toBe(25);
    expect(JSON.parse(update.resultData)).toEqual({
      stage: "docling_convert",
      message: "Converting document with Docling",
      lastHeartbeatAt: "2026-06-27T08:00:00.000Z",
    });
  });

  it("clamps progress to the active task range", () => {
    expect(buildConvertTaskProgressUpdate({ progress: 1 }).progress).toBe(5);
    expect(buildConvertTaskProgressUpdate({ progress: 100 }).progress).toBe(99);
  });
});
