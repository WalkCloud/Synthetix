import { describe, expect, it } from "vitest";

import { shouldEnqueueWikiSynthesis, shouldEnqueueGraphIndex } from "@/lib/queue/workers/index-mode-flags";

describe("shouldEnqueueWikiSynthesis", () => {
  it("defaults to true when wikiEnabled is undefined (opt-out design)", () => {
    expect(shouldEnqueueWikiSynthesis({})).toBe(true);
  });

  it("defaults to true when wikiEnabled is explicitly true", () => {
    expect(shouldEnqueueWikiSynthesis({ wikiEnabled: true })).toBe(true);
  });

  it("returns false when wikiEnabled is explicitly false", () => {
    expect(shouldEnqueueWikiSynthesis({ wikiEnabled: false })).toBe(false);
  });

  it("returns false when indexTarget is 'original' (no chunks to synthesize)", () => {
    expect(shouldEnqueueWikiSynthesis({ indexTarget: "original" })).toBe(false);
  });

  it("returns true when indexTarget is 'full' (default)", () => {
    expect(shouldEnqueueWikiSynthesis({ indexTarget: "full" })).toBe(true);
  });

  it("returns false when wikiEnabled is false even if indexTarget is full", () => {
    expect(shouldEnqueueWikiSynthesis({ wikiEnabled: false, indexTarget: "full" })).toBe(false);
  });

  it("respects wikiEnabled=false over indexTarget", () => {
    expect(shouldEnqueueWikiSynthesis({ wikiEnabled: false, indexTarget: "original" })).toBe(false);
  });
});

describe("shouldEnqueueGraphIndex (regression — unchanged by wiki work)", () => {
  it("returns true for graph + full", () => {
    expect(shouldEnqueueGraphIndex({ indexMode: "graph", indexTarget: "full" })).toBe(true);
  });

  it("returns false for basic mode", () => {
    expect(shouldEnqueueGraphIndex({ indexMode: "basic", indexTarget: "full" })).toBe(false);
  });

  it("returns false for original target", () => {
    expect(shouldEnqueueGraphIndex({ indexMode: "graph", indexTarget: "original" })).toBe(false);
  });
});
