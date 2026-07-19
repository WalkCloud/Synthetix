/**
 * Size → processing-time estimation for the document upload hint.
 *
 * Document processing (convert → split → embed → index → optional graph
 * extraction) is asynchronous and size-dependent. These pure functions turn a
 * file's byte size into a coarse, human time range so the upload UI can tell
 * users what to expect — without making precise promises the pipeline can't
 * keep. Intentionally conservative: ranges, not point estimates.
 */

import type { KnowledgeMode } from "@/lib/documents/knowledge-mode";

export type { KnowledgeMode } from "@/lib/documents/knowledge-mode";
export type ProcessingLevel = "fast" | "medium" | "slow" | "heavy";

export interface ProcessingEstimateInput {
  totalBytes: number;
  fileCount: number;
  knowledgeMode: KnowledgeMode;
}

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
 * Size → base time tiers for the regular convert/split/embed/index pipeline.
 * The ranges are deliberately conservative because local model throughput and
 * document complexity vary significantly between installations.
 */
const TIERS: readonly Tier[] = [
  { level: "fast", maxBytes: 5 * MB, minMin: 0.5, maxMin: 2 },
  { level: "medium", maxBytes: 20 * MB, minMin: 2, maxMin: 8 },
  { level: "slow", maxBytes: 50 * MB, minMin: 8, maxMin: 20 },
  { level: "heavy", maxBytes: Infinity, minMin: 20, maxMin: 45 },
];

const MODE_MULTIPLIERS: Record<KnowledgeMode, { min: number; max: number }> = {
  standard: { min: 1, max: 1 },
  graph: { min: 1.5, max: 2 },
  wiki: { min: 2, max: 2.25 },
  full: { min: 2.5, max: 3.25 },
};

const MAX_TOTAL_BYTES = Number.MAX_SAFE_INTEGER;
const MAX_FILE_COUNT = 100;

interface FileOverheadTier {
  /** Number of additional files covered by this tier. */
  count: number;
  minMinutes: number;
  maxMinutes: number;
}

const FILE_OVERHEAD_TIERS: readonly FileOverheadTier[] = [
  { count: 9, minMinutes: 0.5, maxMinutes: 1 },
  { count: 90, minMinutes: 0.1, maxMinutes: 0.25 },
];

function normalizeNonNegativeInteger(value: number, max: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.floor(value), max);
}

function calculateFileOverhead(fileCount: number): { min: number; max: number } {
  let remaining = Math.max(0, fileCount - 1);
  let min = 0;
  let max = 0;

  for (const tier of FILE_OVERHEAD_TIERS) {
    const filesInTier = Math.min(remaining, tier.count);
    min += filesInTier * tier.minMinutes;
    max += filesInTier * tier.maxMinutes;
    remaining -= filesInTier;
    if (remaining === 0) break;
  }

  return { min, max };
}

/** Estimate a conservative processing-time range for an uploaded batch. */
export function estimateProcessingTime({
  totalBytes,
  fileCount,
  knowledgeMode,
}: ProcessingEstimateInput): ProcessingEstimate {
  const normalizedBytes = normalizeNonNegativeInteger(totalBytes, MAX_TOTAL_BYTES);
  const normalizedFileCount = normalizeNonNegativeInteger(fileCount, MAX_FILE_COUNT);
  const tier =
    normalizedBytes === 0
      ? TIERS[0]
      : TIERS.find((candidate) => normalizedBytes < candidate.maxBytes) ?? TIERS[TIERS.length - 1];
  const multiplier = MODE_MULTIPLIERS[knowledgeMode];
  const fileOverhead = calculateFileOverhead(normalizedFileCount);

  const minMin = Math.max(
    1,
    Math.round(tier.minMin * multiplier.min + fileOverhead.min),
  );
  const maxMin = Math.max(
    minMin,
    Math.round(tier.maxMin * multiplier.max + fileOverhead.max),
  );

  return { level: tier.level, minMin, maxMin };
}

/**
 * @deprecated Use {@link estimateProcessingTime} for knowledge-mode and file-count estimates.
 */
export function estimateProcessingRange(
  totalBytes: number,
  graphMode: boolean,
): ProcessingEstimate {
  return estimateProcessingTime({
    totalBytes,
    fileCount: 1,
    knowledgeMode: graphMode ? "graph" : "standard",
  });
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
  const maxHours = Math.ceil(maxMin / 60);
  return templates.mixed
    .replace("{min}", String(minMin))
    .replace("{max}", String(maxHours));
}

/** Backward-compatible name retained for existing consumers. */
export const formatProcessingTimeRange = formatDurationRange;
