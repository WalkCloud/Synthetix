import { describe, expect, it } from "vitest";
import { shouldEnqueueGraphIndex } from "@/lib/queue/workers/index-mode-flags";

describe("shouldEnqueueGraphIndex", () => {
  it("returns true only for full-target graph-mode documents", () => {
    expect(shouldEnqueueGraphIndex({ indexTarget: "full", indexMode: "graph" })).toBe(true);
  });

  it("returns false when indexTarget is not full", () => {
    expect(shouldEnqueueGraphIndex({ indexTarget: "chunks", indexMode: "graph" })).toBe(false);
    expect(shouldEnqueueGraphIndex({ indexTarget: "original", indexMode: "graph" })).toBe(false);
  });

  it("returns false when indexMode is not graph", () => {
    expect(shouldEnqueueGraphIndex({ indexTarget: "full", indexMode: "basic" })).toBe(false);
    expect(shouldEnqueueGraphIndex({ indexTarget: "full" })).toBe(false);
  });

  it("treats missing indexTarget as 'full' (the default)", () => {
    expect(shouldEnqueueGraphIndex({ indexMode: "graph" })).toBe(true);
  });
});
