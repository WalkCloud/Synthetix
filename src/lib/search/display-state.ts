export type SearchMode = "keyword" | "semantic";

export function getVisibleSearchState(input: {
  selectedMode: SearchMode;
  lastSearchMode: SearchMode | null;
  resultsCount: number;
  hasQuery: boolean;
}) {
  const hasResults = input.resultsCount > 0;
  const isStaleMode = hasResults && input.lastSearchMode !== null && input.lastSearchMode !== input.selectedMode;

  return {
    resultMode: input.lastSearchMode ?? input.selectedMode,
    shouldShowResults: hasResults && !isStaleMode,
    needsSearchForSelectedMode: input.hasQuery && isStaleMode,
  };
}
