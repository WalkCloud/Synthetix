/**
 * Phase 3 entry condition: encode the single/compare/bulk behavior matrix
 * as a contract test so the intended differences are explicit and the
 * unintended drift (compare lacking Wiki retrieval/writeback) is visible.
 *
 * This test documents the CURRENT behavior and the TARGET behavior after
 * the writing Application Module centralization. When the module is built,
 * these policies become code-enforced rather than route-scattered.
 */
import { describe, it, expect } from "vitest";

export type WritingMode = "single" | "compare" | "bulk";
export type PolicyField =
  | "tokenModule"
  | "autoConfirm"
  | "createAssetsAt"
  | "audit"
  | "wikiRetrieval"
  | "wikiWriteback"
  | "summary"
  | "versionSource"
  | "stream";

interface ModePolicy {
  tokenModule: "writing" | "comparison";
  autoConfirm: boolean;
  createAssetsAt: "generate" | "confirm" | "never";
  audit: "background" | "off";
  wikiRetrieval: boolean;
  wikiWriteback: boolean;
  summary: "in-flow" | "at-confirm" | "off";
  versionSource: string;
  stream: boolean;
}

// CURRENT behavior (observed from code). Fields marked TARGET_FIX are known
// drift that the Application Module must resolve.
const CURRENT_POLICIES: Record<WritingMode, ModePolicy> = {
  single: {
    tokenModule: "writing",
    autoConfirm: false,
    createAssetsAt: "generate",
    audit: "background",
    wikiRetrieval: true,
    wikiWriteback: true,
    summary: "at-confirm",
    versionSource: "edited",
    stream: true,
  },
  compare: {
    tokenModule: "comparison",
    autoConfirm: false,
    createAssetsAt: "confirm",
    audit: "off",
    wikiRetrieval: false, // TARGET_FIX: should be true (guide §13.1)
    wikiWriteback: false, // TARGET_FIX: should be true when wiki ran
    summary: "at-confirm",
    versionSource: "generated_a",
    stream: true,
  },
  bulk: {
    tokenModule: "writing",
    autoConfirm: true,
    createAssetsAt: "generate",
    audit: "off",
    wikiRetrieval: true,
    wikiWriteback: false, // TARGET_FIX: should be true (guide §13.1)
    summary: "in-flow",
    versionSource: "generated",
    stream: false,
  },
};

// TARGET behavior after centralization: all modes share the same
// retrieval/writeback policy; differences are intentional (autoConfirm,
// assets, audit, summary, versionSource, stream).
const TARGET_POLICIES: Record<WritingMode, ModePolicy> = {
  single: {
    tokenModule: "writing",
    autoConfirm: false,
    createAssetsAt: "generate",
    audit: "background",
    wikiRetrieval: true,
    wikiWriteback: true,
    summary: "at-confirm",
    versionSource: "edited",
    stream: true,
  },
  compare: {
    tokenModule: "comparison",
    autoConfirm: false,
    createAssetsAt: "confirm",
    audit: "off",
    wikiRetrieval: true, // FIXED
    wikiWriteback: true,  // FIXED
    summary: "at-confirm",
    versionSource: "generated_a",
    stream: true,
  },
  bulk: {
    tokenModule: "writing",
    autoConfirm: true,
    createAssetsAt: "generate",
    audit: "off",
    wikiRetrieval: true,
    wikiWriteback: true, // FIXED
    summary: "in-flow",
    versionSource: "generated",
    stream: false,
  },
};

describe("writing mode policy matrix", () => {
  it("documents intended per-mode differences", () => {
    // autoConfirm: only bulk auto-confirms
    expect(CURRENT_POLICIES.bulk.autoConfirm).toBe(true);
    expect(CURRENT_POLICIES.single.autoConfirm).toBe(false);
    expect(CURRENT_POLICIES.compare.autoConfirm).toBe(false);

    // stream: single and compare stream; bulk does not
    expect(CURRENT_POLICIES.single.stream).toBe(true);
    expect(CURRENT_POLICIES.compare.stream).toBe(true);
    expect(CURRENT_POLICIES.bulk.stream).toBe(false);

    // summary timing: bulk is in-flow; others defer to confirm
    expect(CURRENT_POLICIES.bulk.summary).toBe("in-flow");
    expect(CURRENT_POLICIES.single.summary).toBe("at-confirm");
    expect(CURRENT_POLICIES.compare.summary).toBe("at-confirm");
  });

  it("identifies the known drift fields that the Application Module must fix", () => {
    const driftFields: Array<{ mode: WritingMode; field: keyof ModePolicy }> = [
      { mode: "compare", field: "wikiRetrieval" },
      { mode: "compare", field: "wikiWriteback" },
      { mode: "bulk", field: "wikiWriteback" },
    ];
    for (const { mode, field } of driftFields) {
      expect(CURRENT_POLICIES[mode][field]).not.toEqual(TARGET_POLICIES[mode][field]);
    }
  });

  it("ensures target policies give all modes the same retrieval+writeback policy", () => {
    const retrievalValues = Object.values(TARGET_POLICIES).map((p) => p.wikiRetrieval);
    const writebackValues = Object.values(TARGET_POLICIES).map((p) => p.wikiWriteback);
    expect(new Set(retrievalValues).size).toBe(1);
    expect(new Set(writebackValues).size).toBe(1);
    expect(retrievalValues[0]).toBe(true);
    expect(writebackValues[0]).toBe(true);
  });
});
