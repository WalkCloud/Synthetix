import { describe, expect, it } from "vitest";
import {
  estimateProcessingRange,
  estimateProcessingTime,
  formatDurationRange,
  formatProcessingTimeRange,
  LARGE_FILE_TOAST_THRESHOLD,
} from "@/lib/documents/estimate";
import type { KnowledgeMode } from "@/lib/documents/knowledge-mode";

const MB = 1024 * 1024;

describe("estimateProcessingTime", () => {
  it.each([
    { totalBytes: 1 * MB, level: "fast", minMin: 1, maxMin: 2 },
    { totalBytes: 10 * MB, level: "medium", minMin: 2, maxMin: 8 },
    { totalBytes: 30 * MB, level: "slow", minMin: 8, maxMin: 20 },
    { totalBytes: 80 * MB, level: "heavy", minMin: 20, maxMin: 45 },
  ] as const)("uses the $level base tier for $totalBytes bytes", ({ totalBytes, level, minMin, maxMin }) => {
    expect(estimateProcessingTime({ totalBytes, fileCount: 1, knowledgeMode: "standard" }))
      .toEqual({ level, minMin, maxMin });
  });

  it.each([
    { totalBytes: 5 * MB - 1, level: "fast" },
    { totalBytes: 5 * MB, level: "medium" },
    { totalBytes: 20 * MB, level: "slow" },
    { totalBytes: 50 * MB, level: "heavy" },
  ] as const)("respects the tier boundary at $totalBytes bytes", ({ totalBytes, level }) => {
    expect(estimateProcessingTime({ totalBytes, fileCount: 1, knowledgeMode: "standard" }).level)
      .toBe(level);
  });

  it.each([
    { knowledgeMode: "standard", minMin: 2, maxMin: 8 },
    { knowledgeMode: "graph", minMin: 3, maxMin: 16 },
    { knowledgeMode: "wiki", minMin: 4, maxMin: 18 },
    { knowledgeMode: "full", minMin: 5, maxMin: 26 },
  ] satisfies Array<{ knowledgeMode: KnowledgeMode; minMin: number; maxMin: number }>)(
    "accounts for the $knowledgeMode model stages",
    ({ knowledgeMode, minMin, maxMin }) => {
      expect(estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 1, knowledgeMode }))
        .toEqual({ level: "medium", minMin, maxMin });
    },
  );

  it("applies diminishing per-file overhead and caps extreme file counts", () => {
    const single = estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 1, knowledgeMode: "standard" });
    const ten = estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 10, knowledgeMode: "standard" });
    const hundred = estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 100, knowledgeMode: "standard" });
    const extreme = estimateProcessingTime({ totalBytes: 10 * MB, fileCount: Number.MAX_VALUE, knowledgeMode: "standard" });

    expect(single).toEqual({ level: "medium", minMin: 2, maxMin: 8 });
    expect(ten.maxMin).toBeGreaterThan(single.maxMin);
    expect(hundred.maxMin).toBeGreaterThan(ten.maxMin);
    expect((hundred.maxMin - ten.maxMin) / 90).toBeLessThan((ten.maxMin - single.maxMin) / 9);
    expect(extreme).toEqual(hundred);
  });

  it.each([
    { value: Number.NaN, normalized: 0 },
    { value: Number.NEGATIVE_INFINITY, normalized: 0 },
    { value: -5.9, normalized: 0 },
    { value: 3.9, normalized: 3 },
  ])("normalizes fileCount $value to $normalized", ({ value, normalized }) => {
    expect(estimateProcessingTime({ totalBytes: 10 * MB, fileCount: value, knowledgeMode: "standard" }))
      .toEqual(estimateProcessingTime({ totalBytes: 10 * MB, fileCount: normalized, knowledgeMode: "standard" }));
  });

  it.each([
    { value: Number.NaN, normalized: 0 },
    { value: Number.NEGATIVE_INFINITY, normalized: 0 },
    { value: -5.9, normalized: 0 },
    { value: 0.9, normalized: 0 },
    { value: 5 * MB + 0.9, normalized: 5 * MB },
  ])("normalizes totalBytes $value to $normalized", ({ value, normalized }) => {
    expect(estimateProcessingTime({ totalBytes: value, fileCount: 1, knowledgeMode: "standard" }))
      .toEqual(estimateProcessingTime({ totalBytes: normalized, fileCount: 1, knowledgeMode: "standard" }));
  });

  it("caps positive Infinity inputs instead of returning non-finite estimates", () => {
    const estimate = estimateProcessingTime({
      totalBytes: Number.POSITIVE_INFINITY,
      fileCount: Number.POSITIVE_INFINITY,
      knowledgeMode: "full",
    });

    expect(estimate.level).toBe("heavy");
    expect(Number.isFinite(estimate.minMin)).toBe(true);
    expect(Number.isFinite(estimate.maxMin)).toBe(true);
  });

  it.each([
    { totalBytes: 0, fileCount: 0 },
    { totalBytes: -5, fileCount: -2 },
    { totalBytes: 0.1 * MB, fileCount: 3 },
  ])("returns ordered whole-minute estimates for %#", ({ totalBytes, fileCount }) => {
    const estimate = estimateProcessingTime({ totalBytes, fileCount, knowledgeMode: "full" });
    expect(estimate.level).toBe("fast");
    expect(Number.isInteger(estimate.minMin)).toBe(true);
    expect(Number.isInteger(estimate.maxMin)).toBe(true);
    expect(estimate.minMin).toBeGreaterThanOrEqual(1);
    expect(estimate.maxMin).toBeGreaterThanOrEqual(estimate.minMin);
  });

  it("keeps estimateProcessingRange as a deprecated compatibility wrapper", () => {
    expect(estimateProcessingRange(10 * MB, false)).toEqual(
      estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 1, knowledgeMode: "standard" }),
    );
    expect(estimateProcessingRange(10 * MB, true)).toEqual(
      estimateProcessingTime({ totalBytes: 10 * MB, fileCount: 1, knowledgeMode: "graph" }),
    );
  });

  it("exports a 20MB toast threshold", () => {
    expect(LARGE_FILE_TOAST_THRESHOLD).toBe(20 * MB);
  });
});

describe("formatDurationRange", () => {
  const tpl = {
    seconds: "about {n} seconds",
    minutes: "about {min}-{max} minutes",
    mixed: "about {min} minutes - {max} hours",
  };

  it("renders sub-minute ranges in seconds", () => {
    // 0.5 min lower bound rounds to 1 via the estimator, but the formatter is
    // fed explicit values to test the < 1 branch in isolation.
    expect(formatDurationRange(0.4, 0.6, tpl)).toBe("about 36 seconds");
  });

  it("renders minute ranges when under an hour", () => {
    expect(formatDurationRange(5, 15, tpl)).toBe("about 5-15 minutes");
  });

  it.each([
    { maxMin: 61, hours: 2 },
    { maxMin: 65, hours: 2 },
    { maxMin: 89, hours: 2 },
    { maxMin: 121, hours: 3 },
    { maxMin: 146, hours: 3 },
  ])("rounds the mixed upper bound $maxMin minutes up to $hours hours", ({ maxMin, hours }) => {
    expect(formatDurationRange(45, maxMin, tpl)).toBe(`about 45 minutes - ${hours} hours`);
  });

  it("leaves unknown placeholders untouched", () => {
    expect(formatDurationRange(5, 15, { ...tpl, minutes: "min {min} to {max}" }))
      .toBe("min 5 to 15");
  });

  it("keeps formatProcessingTimeRange as a compatible formatter", () => {
    expect(formatProcessingTimeRange(5, 15, tpl)).toBe(formatDurationRange(5, 15, tpl));
  });
});
