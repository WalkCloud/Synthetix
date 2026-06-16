import { describe, expect, it } from "vitest";
import path from "path";
import { spawnPythonJson } from "@/lib/python";

describe("spawnPythonJson progress events", () => {
  it("emits JSON progress events from stderr lines", async () => {
    const events: unknown[] = [];
    const result = await spawnPythonJson<{ ok: boolean }>(
      path.join("workers", "python", "tests", "fixtures", "progress_emitter.py"),
      [],
      { onProgressEvent: (event) => events.push(event) },
    );

    expect(result).toEqual({ ok: true });
    expect(events).toEqual([
      { type: "progress", stage: "loading", progress: 25, message: "Loading graph engine" },
      { type: "progress", stage: "indexing", progress: 50, processed: 1, total: 2, message: "Extracting entities" },
    ]);
  });
});
