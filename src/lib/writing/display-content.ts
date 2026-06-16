interface ReviewDisplaySection {
  status: string;
  content: string | null;
  contentA: string | null;
  contentB: string | null;
  selectedModel: string | null;
}

export interface ReviewDisplayState {
  hasComparisonCandidates: boolean;
  requiresModelSelection: boolean;
  contentA: string | null;
  contentB: string | null;
  mode: "single" | "compare";
}

export function getReviewDisplayState(section: ReviewDisplaySection): ReviewDisplayState {
  const hasComparisonCandidates = Boolean(section.contentA || section.contentB);
  return {
    hasComparisonCandidates,
    requiresModelSelection: hasComparisonCandidates && !section.selectedModel,
    contentA: hasComparisonCandidates ? section.contentA : section.content,
    contentB: hasComparisonCandidates ? section.contentB : null,
    mode: hasComparisonCandidates && section.contentB ? "compare" : "single",
  };
}
