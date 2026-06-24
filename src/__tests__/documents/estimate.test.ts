import { describe, expect, it } from "vitest";
import {
  estimateProcessingRange,
  formatDurationRange,
  LARGE_FILE_TOAST_THRESHOLD,
} from "@/lib/documents/estimate";

const MB = 1024 * 1024;

describe("estimateProcessingRange", () => {
  it("classifies small payloads as fast", () => {
    const e = estimateProcessingRange(1 * MB, false);
    expect(e.level).toBe("fast");
    expect(e.minMin).toBeGreaterThanOrEqual(1);
    expect(e.maxMin).toBeGreaterThanOrEqual(e.minMin);
  });

  it("classifies mid-size payloads as medium", () => {
    expect(estimateProcessingRange(10 * MB, false).level).toBe("medium");
  });

  it("classifies larger payloads as slow", () => {
    expect(estimateProcessingRange(30 * MB, false).level).toBe("slow");
  });

  it("classifies the largest payloads as heavy", () => {
    const e = estimateProcessingRange(80 * MB, false);
    expect(e.level).toBe("heavy");
    expect(e.minMin).toBeGreaterThanOrEqual(20);
  });

  it("respects tier boundaries", () => {
    // Just under the 5MB fast/medium line → fast.
    expect(estimateProcessingRange(5 * MB - 1, false).level).toBe("fast");
    // Exactly at a boundary lands in the higher tier (strict <).
    expect(estimateProcessingRange(5 * MB, false).level).toBe("medium");
    expect(estimateProcessingRange(20 * MB, false).level).toBe("slow");
    expect(estimateProcessingRange(50 * MB, false).level).toBe("heavy");
  });

  it("multiplies the range when graph mode is on", () => {
    const basic = estimateProcessingRange(30 * MB, false);
    const graph = estimateProcessingRange(30 * MB, true);
    expect(graph.level).toBe("slow"); // tier is driven by size, not mode
    expect(graph.minMin).toBeGreaterThan(basic.minMin);
    expect(graph.maxMin).toBeGreaterThan(basic.maxMin);
  });

  it("floors the range at 1 minute and returns whole numbers", () => {
    const e = estimateProcessingRange(0.1 * MB, false);
    expect(Number.isInteger(e.minMin)).toBe(true);
    expect(Number.isInteger(e.maxMin)).toBe(true);
    expect(e.minMin).toBeGreaterThanOrEqual(1);
    expect(e.maxMin).toBeGreaterThanOrEqual(1);
  });

  it("treats non-positive sizes as the fast tier", () => {
    expect(estimateProcessingRange(0, false).level).toBe("fast");
    expect(estimateProcessingRange(-5, false).level).toBe("fast");
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

  it("renders a mixed minute/hour range when the upper bound spans an hour", () => {
    expect(formatDurationRange(45, 90, tpl)).toBe("about 45 minutes - 2 hours");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(formatDurationRange(5, 15, { ...tpl, minutes: "min {min} to {max}" }))
      .toBe("min 5 to 15");
  });
});
