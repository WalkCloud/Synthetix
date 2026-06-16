import { describe, expect, it } from "vitest";
import { getVisibleSearchState } from "@/lib/search/display-state";

describe("search display state", () => {
  it("treats previous keyword results as stale after switching to semantic mode", () => {
    const state = getVisibleSearchState({
      selectedMode: "semantic",
      lastSearchMode: "keyword",
      resultsCount: 2,
      hasQuery: true,
    });

    expect(state.resultMode).toBe("keyword");
    expect(state.shouldShowResults).toBe(false);
    expect(state.needsSearchForSelectedMode).toBe(true);
  });

  it("shows results when they were produced by the selected mode", () => {
    const state = getVisibleSearchState({
      selectedMode: "semantic",
      lastSearchMode: "semantic",
      resultsCount: 2,
      hasQuery: true,
    });

    expect(state.resultMode).toBe("semantic");
    expect(state.shouldShowResults).toBe(true);
    expect(state.needsSearchForSelectedMode).toBe(false);
  });
});
