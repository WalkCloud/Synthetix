import { describe, expect, it } from "vitest";

import { shouldEnqueueWikiSynthesis, shouldEnqueueGraphIndex, derivePipelineModes } from "@/lib/queue/workers/index-mode-flags";

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

describe("derivePipelineModes (shared list↔detail pipeline-branch derivation)", () => {
  // Each Knowledge Mode maps to a stored-options shape on the convert task.
  const mkConvertInput = (options: Record<string, unknown>) =>
    JSON.stringify({ docId: "d1", options });

  it("standard mode → no graph, no wiki", () => {
    const r = derivePipelineModes(mkConvertInput({ indexMode: "basic", wikiEnabled: false, indexTarget: "full" }), false, false);
    expect(r).toEqual({ graphMode: false, wikiEnabled: false });
  });

  it("graph mode → graph on, wiki off", () => {
    const r = derivePipelineModes(mkConvertInput({ indexMode: "graph", wikiEnabled: false, indexTarget: "full" }), false, false);
    expect(r).toEqual({ graphMode: true, wikiEnabled: false });
  });

  it("wiki mode → graph off, wiki on", () => {
    const r = derivePipelineModes(mkConvertInput({ indexMode: "basic", wikiEnabled: true, indexTarget: "full" }), false, false);
    expect(r).toEqual({ graphMode: false, wikiEnabled: true });
  });

  it("full mode → graph on, wiki on", () => {
    const r = derivePipelineModes(mkConvertInput({ indexMode: "graph", wikiEnabled: true, indexTarget: "full" }), false, false);
    expect(r).toEqual({ graphMode: true, wikiEnabled: true });
  });

  it("falls back to task presence when options are missing/malformed", () => {
    expect(derivePipelineModes(null, true, false)).toEqual({ graphMode: true, wikiEnabled: false });
    expect(derivePipelineModes("not-json", false, true)).toEqual({ graphMode: false, wikiEnabled: true });
  });

  it("task presence backstops even when options say otherwise (recovery run)", () => {
    // Options say basic (no graph), but a rag_index task exists → show graph.
    // wikiEnabled defaults true (opt-out), so it stays true here.
    expect(derivePipelineModes(mkConvertInput({ indexMode: "basic" }), true, false)).toEqual({ graphMode: true, wikiEnabled: true });
    // Explicitly-disabled wiki but a wiki task exists → still show the branch.
    expect(derivePipelineModes(mkConvertInput({ indexMode: "basic", wikiEnabled: false }), false, true)).toEqual({ graphMode: false, wikiEnabled: true });
  });
});
