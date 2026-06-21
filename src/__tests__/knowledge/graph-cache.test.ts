import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getCachedGraph,
  setCachedGraph,
  invalidateUserGraph,
  clearGraphCache,
} from "@/lib/knowledge/graph-cache";

const PARAMS = { entityName: "", depth: 2, maxNodes: 150, mode: "core", minDegree: 1 };

describe("graph-cache", () => {
  beforeEach(() => {
    clearGraphCache();
  });

  it("returns undefined on a miss", () => {
    expect(getCachedGraph("u1", PARAMS)).toBeUndefined();
  });

  it("returns stored data on a hit", () => {
    const data = { entity: "x", graph: { nodes: [], edges: [] } };
    setCachedGraph("u1", PARAMS, data);
    expect(getCachedGraph("u1", PARAMS)).toEqual(data);
  });

  it("treats different params as distinct entries", () => {
    setCachedGraph("u1", { ...PARAMS, mode: "core" }, "core-data");
    setCachedGraph("u1", { ...PARAMS, mode: "graph", entityName: "e1" }, "graph-data");
    expect(getCachedGraph("u1", { ...PARAMS, mode: "core" })).toBe("core-data");
    expect(getCachedGraph("u1", { ...PARAMS, mode: "graph", entityName: "e1" })).toBe("graph-data");
  });

  it("isolates users from each other", () => {
    setCachedGraph("u1", PARAMS, "u1-data");
    expect(getCachedGraph("u2", PARAMS)).toBeUndefined();
  });

  it("expires entries after the TTL elapses", () => {
    vi.useFakeTimers();
    try {
      setCachedGraph("u1", PARAMS, "stale", 30_000);
      expect(getCachedGraph("u1", PARAMS)).toBe("stale");
      vi.advanceTimersByTime(30_001);
      expect(getCachedGraph("u1", PARAMS)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest entry once capacity is reached", () => {
    // MAX_ENTRIES is 64; fill then add one more — the first inserted must go.
    const firstParams = { ...PARAMS, entityName: "first" };
    setCachedGraph("u1", firstParams, "first-data");
    for (let i = 0; i < 64; i++) {
      setCachedGraph("u1", { ...PARAMS, entityName: `e${i}` }, `d${i}`);
    }
    // The first entry was pushed out by capacity pressure.
    expect(getCachedGraph("u1", firstParams)).toBeUndefined();
  });

  it("promotes a hit to most-recent so it survives eviction", () => {
    const survivor = { ...PARAMS, entityName: "survivor" };
    setCachedGraph("u1", survivor, "keep");
    // Fill with other entries but re-read the survivor each time to refresh it.
    for (let i = 0; i < 64; i++) {
      setCachedGraph("u1", { ...PARAMS, entityName: `fill${i}` }, `f${i}`);
      getCachedGraph("u1", survivor); // touch → refresh recency
    }
    expect(getCachedGraph("u1", survivor)).toBe("keep");
  });

  it("invalidateUserGraph drops only the targeted user's entries", () => {
    setCachedGraph("u1", PARAMS, "u1-data");
    setCachedGraph("u2", PARAMS, "u2-data");
    invalidateUserGraph("u1");
    expect(getCachedGraph("u1", PARAMS)).toBeUndefined();
    expect(getCachedGraph("u2", PARAMS)).toBe("u2-data");
  });

  it("clearGraphCache empties everything", () => {
    setCachedGraph("u1", PARAMS, "data");
    clearGraphCache();
    expect(getCachedGraph("u1", PARAMS)).toBeUndefined();
  });
});
