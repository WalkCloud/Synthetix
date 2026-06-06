import { describe, expect, it } from "vitest";
import { getInitialIndexMode, shouldEnqueueGraphIndex } from "@/lib/queue/workers/document-worker";

describe("document worker index mode helpers", () => {
  it("uses basic indexing first when graph mode is requested", () => {
    expect(getInitialIndexMode({ indexMode: "graph" })).toBe("basic");
  });

  it("keeps basic indexing when graph mode is not requested", () => {
    expect(getInitialIndexMode({ indexMode: "basic" })).toBe("basic");
    expect(getInitialIndexMode({})).toBe("basic");
  });

  it("enqueues graph indexing only for full graph documents", () => {
    expect(shouldEnqueueGraphIndex({ indexTarget: "full", indexMode: "graph" })).toBe(true);
    expect(shouldEnqueueGraphIndex({ indexTarget: "chunks", indexMode: "graph" })).toBe(false);
    expect(shouldEnqueueGraphIndex({ indexTarget: "full", indexMode: "basic" })).toBe(false);
  });
});
