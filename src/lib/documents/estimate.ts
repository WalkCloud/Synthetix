/**
 * Size → processing-time estimation for the document upload hint.
 *
 * Document processing (convert → split → embed → index → optional graph
 * extraction) is asynchronous and size-dependent. These pure functions turn a
 * file's byte size into a coarse, human time range so the upload UI can tell
 * users what to expect — without making precise promises the pipeline can't
 * keep. Intentionally conservative: ranges, not point estimates.
 */

export type ProcessingLevel = "fast" | "medium" | "slow" | "heavy";

export interface ProcessingEstimate {
  /** Qualitative bucket, drives icon + color + copy. */
  level: ProcessingLevel;
  /** Lower bound in minutes (already tier-scaled + graph-adjusted, rounded). */
  minMin: number;
  /** Upper bound in minutes (already tier-scaled + graph-adjusted, rounded). */
  maxMin: number;
}

const MB = 1024 * 1024;

interface Tier {
  level: ProcessingLevel;
  /** Upper size bound (bytes) for this tier, exclusive. Infinity for the last. */
  maxBytes: number;
  minMin: number;
  maxMin: number;
}

/**
 * Size → base time tiers (basic / chunk-only mode).
 * Tuned against typical convert+embed throughput; graph extraction adds more
 * via the `graphMode` multiplier in {@link estimateProcessingRange}.
 */
const TIERS: readonly Tier[] = [
  { level: "fast", maxBytes: 5 * MB, minMin: 0.5, maxMin: 2 },
  { level: "medium", maxBytes: 20 * MB, minMin: 2, maxMin: 8 },
  { level: "slow", maxBytes: 50 * MB, minMin: 8, maxMin: 20 },
  { level: "heavy", maxBytes: Infinity, minMin: 20, maxMin: 45 },
];

/**
 * Estimate a processing-time range for a total payload size.
 *
 * @param totalBytes  Sum of uploaded file sizes in bytes.
 * @param graphMode   When true, LLM entity/relation extraction runs and roughly
 *                    multiplies the time (1.5× lower bound, 1.8× upper bound).
 */
export function estimateProcessingRange(
  totalBytes: number,
  graphMode: boolean,
): ProcessingEstimate {
  const tier =
    totalBytes <= 0
      ? TIERS[0]
      : TIERS.find((t) => totalBytes < t.maxBytes) ?? TIERS[TIERS.length - 1];

  const minMin = tier.minMin * (graphMode ? 1.5 : 1);
  const maxMin = tier.maxMin * (graphMode ? 1.8 : 1);

  return {
    level: tier.level,
    minMin: Math.max(1, Math.round(minMin)),
    maxMin: Math.max(1, Math.round(maxMin)),
  };
}

/** Smallest size (bytes) at which the upload-success toast fires. */
export const LARGE_FILE_TOAST_THRESHOLD = 20 * MB;

/**
 * Human-friendly duration formatting for the estimate range.
 *
 * Delegates the localized glue words (`about`, `minutes`, `hours`, `seconds`)
 * to the caller via simple string templates with `{min}` / `{max}` / `{n}`
 * placeholders — keeps this module locale-free and unit-testable.
 *
 * @returns The `{ range }` substitution string, e.g. "about 30 seconds",
 *          "about 5-15 minutes", or "about 45 minutes - 2 hours".
 */
export function formatDurationRange(
  minMin: number,
  maxMin: number,
  templates: {
    /** e.g. "about {n} seconds" — used when both bounds round under a minute. */
    seconds: string;
    /** e.g. "about {min}-{max} minutes" — both bounds under an hour. */
    minutes: string;
    /** e.g. "about {min} minutes - {max} hours" — upper bound reaches/passes an hour. */
    mixed: string;
  },
): string {
  // Sub-minute: show as seconds for a friendlier feel.
  if (minMin < 1 && maxMin < 1) {
    return templates.seconds.replace("{n}", String(Math.max(1, Math.round(maxMin * 60))));
  }

  if (maxMin < 60) {
    return templates.minutes
      .replace("{min}", String(minMin))
      .replace("{max}", String(maxMin));
  }

  // Spans an hour: render the upper bound in hours.
  const maxHours = Math.round(maxMin / 60);
  return templates.mixed
    .replace("{min}", String(minMin))
    .replace("{max}", String(maxHours));
}
