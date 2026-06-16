import { describe, expect, it } from "vitest";
import { getReviewDisplayState } from "@/lib/writing/display-content";

describe("getReviewDisplayState", () => {
  it("shows edited content for revising sections without comparison candidates", () => {
    const state = getReviewDisplayState({
      status: "revising",
      content: "edited content",
      contentA: null,
      contentB: null,
      selectedModel: null,
    });

    expect(state.contentA).toBe("edited content");
    expect(state.contentB).toBeNull();
    expect(state.requiresModelSelection).toBe(false);
  });

  it("requires explicit model selection for fresh comparison candidates", () => {
    const state = getReviewDisplayState({
      status: "reviewing",
      content: null,
      contentA: "model A content",
      contentB: "model B content",
      selectedModel: null,
    });

    expect(state.contentA).toBe("model A content");
    expect(state.contentB).toBe("model B content");
    expect(state.hasComparisonCandidates).toBe(true);
    expect(state.requiresModelSelection).toBe(true);
  });

  it("allows confirmation after a comparison candidate is selected", () => {
    const state = getReviewDisplayState({
      status: "reviewing",
      content: "model A content",
      contentA: "model A content",
      contentB: "model B content",
      selectedModel: "model-a-id",
    });

    expect(state.requiresModelSelection).toBe(false);
  });

  it("shows single-model content when there are no comparison candidates", () => {
    const state = getReviewDisplayState({
      status: "reviewing",
      content: "single model content",
      contentA: null,
      contentB: null,
      selectedModel: null,
    });

    expect(state.contentA).toBe("single model content");
    expect(state.contentB).toBeNull();
    expect(state.mode).toBe("single");
  });
});
