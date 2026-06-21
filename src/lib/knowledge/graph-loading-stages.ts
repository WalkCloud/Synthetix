/**
 * Estimated, time-based loading progress for the Knowledge Graph fetch.
 *
 * The graph API returns a single JSON response, so there is no real per-step
 * progress to subscribe to during the request. Instead we derive a smooth,
 * non-linear estimate from elapsed time and surface it as staged feedback.
 * The estimate is explicitly labelled as such in the UI to stay honest.
 *
 * Curve: progress = 92 * (1 - e^(-t/5000)).
 * Rises fast in the first few seconds, then eases off and plateaus at 92%
 * while the request is still in flight. The caller jumps it to 100% when the
 * response actually arrives.
 */

export interface KGLoadingStageDef {
  /** i18n key under `search.*` resolved by the caller. */
  stageLabelKey: string;
  /** Upper bound of elapsed time (ms) for this stage before advancing. */
  elapsedCutoffMs: number;
}

export const KG_LOADING_STAGES: readonly KGLoadingStageDef[] = [
  { stageLabelKey: "loadingStageInit", elapsedCutoffMs: 1500 },
  { stageLabelKey: "loadingStageTraverse", elapsedCutoffMs: 6000 },
  { stageLabelKey: "loadingStageBuild", elapsedCutoffMs: Number.POSITIVE_INFINITY },
] as const;

/** Plateau the estimate sits at while waiting; caller pushes to 100 on completion. */
export const KG_LOADING_ESTIMATE_CEIL = 92;

const TIME_CONSTANT_MS = 5000;

export interface KGLoadingProgress {
  /** i18n key under `search.*` for the current stage label. */
  stage: string;
  /** Estimated progress, clamped to [0, KG_LOADING_ESTIMATE_CEIL]. */
  progress: number;
}

/**
 * Given elapsed milliseconds since the request started, return the current
 * stage key and an estimated progress percentage (never exceeds the ceil).
 */
export function getKGLoadingProgress(elapsedMs: number): KGLoadingProgress {
  const elapsed = Math.max(0, elapsedMs);
  const stage = KG_LOADING_STAGES.find((s) => elapsed <= s.elapsedCutoffMs)
    ?? KG_LOADING_STAGES[KG_LOADING_STAGES.length - 1];
  const progress = KG_LOADING_ESTIMATE_CEIL * (1 - Math.exp(-elapsed / TIME_CONSTANT_MS));
  return { stage: stage.stageLabelKey, progress };
}
