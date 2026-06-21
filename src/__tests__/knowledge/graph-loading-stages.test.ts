import { describe, expect, it } from "vitest";
import {
  getKGLoadingProgress,
  KG_LOADING_ESTIMATE_CEIL,
  KG_LOADING_STAGES,
} from "@/lib/knowledge/graph-loading-stages";

describe("getKGLoadingProgress", () => {
  it("starts at the init stage with zero progress", () => {
    const r = getKGLoadingProgress(0);
    expect(r.stage).toBe("loadingStageInit");
    expect(r.progress).toBe(0);
  });

  it("monotonically increases progress as time passes", () => {
    let prev = 0;
    for (const ms of [500, 1500, 3000, 6000, 10000, 20000]) {
      const { progress } = getKGLoadingProgress(ms);
      expect(progress).toBeGreaterThanOrEqual(prev);
      prev = progress;
    }
  });

  it("never exceeds the estimate ceil while waiting", () => {
    for (const ms of [0, 1000, 5000, 10000, 30000, 120000]) {
      expect(getKGLoadingProgress(ms).progress).toBeLessThanOrEqual(KG_LOADING_ESTIMATE_CEIL);
    }
  });

  it("plateaus near the ceil for long waits without crossing it", () => {
    const r = getKGLoadingProgress(60000);
    expect(r.progress).toBeGreaterThan(KG_LOADING_ESTIMATE_CEIL - 1);
    expect(r.progress).toBeLessThanOrEqual(KG_LOADING_ESTIMATE_CEIL);
  });

  it("advances through every stage as time passes", () => {
    expect(getKGLoadingProgress(0).stage).toBe("loadingStageInit");
    expect(getKGLoadingProgress(2000).stage).toBe("loadingStageTraverse");
    expect(getKGLoadingProgress(7000).stage).toBe("loadingStageBuild");
  });

  it("clamps negative elapsed to zero", () => {
    const r = getKGLoadingProgress(-500);
    expect(r.progress).toBe(0);
    expect(r.stage).toBe("loadingStageInit");
  });

  it("covers every stage key in its stage list", () => {
    const keys = KG_LOADING_STAGES.map((s) => s.stageLabelKey);
    expect(keys).toContain("loadingStageInit");
    expect(keys).toContain("loadingStageTraverse");
    expect(keys).toContain("loadingStageBuild");
  });
});
