import { describe, expect, it } from "vitest";
import path from "path";
import { spawnPythonJson } from "@/lib/python";

describe("spawnPythonJson usage events", () => {
  it("dispatches stderr lines with type='usage' to onUsageEvent", async () => {
    const progressEvents: unknown[] = [];
    const usageEvents: unknown[] = [];
    const result = await spawnPythonJson<{ ok: boolean }>(
      path.join("workers", "python", "tests", "fixtures", "usage_emitter.py"),
      [],
      {
        onProgressEvent: (event) => progressEvents.push(event),
        onUsageEvent: (event) => usageEvents.push(event),
      },
    );

    expect(result).toEqual({ ok: true });
    expect(progressEvents).toEqual([
      { type: "progress", stage: "loading", progress: 10, message: "init" },
    ]);
    expect(usageEvents).toEqual([
      { type: "usage", module: "graph", input_tokens: 1234, output_tokens: 567 },
      { type: "usage", module: "graph", input_tokens: 100, output_tokens: 50 },
    ]);
  });

  it("usage events do not contaminate the parsed JSON return value", async () => {
    const result = await spawnPythonJson<{ ok: boolean }>(
      path.join("workers", "python", "tests", "fixtures", "usage_emitter.py"),
      [],
      {},
    );
    expect(result).toEqual({ ok: true });
  });
});
