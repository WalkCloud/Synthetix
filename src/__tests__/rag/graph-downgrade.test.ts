import { describe, expect, it } from "vitest";

import {
  LIGHTRAG_MIN_DIM,
  isLightRAGCompatible,
  resolveGraphDowngrade,
  graphDowngradeWarning,
} from "@/lib/rag/dimension";

describe("resolveGraphDowngrade", () => {
  it("leaves basic mode untouched regardless of dimension", () => {
    expect(resolveGraphDowngrade("basic", { modelId: "m", embeddingDim: 768 })).toEqual({
      indexMode: "basic",
      downgraded: false,
    });
    expect(resolveGraphDowngrade("basic", { modelId: "m", embeddingDim: 3072 })).toEqual({
      indexMode: "basic",
      downgraded: false,
    });
  });

  it("keeps graph mode when the model dimension meets the minimum", () => {
    expect(resolveGraphDowngrade("graph", { modelId: "m", embeddingDim: LIGHTRAG_MIN_DIM })).toEqual({
      indexMode: "graph",
      downgraded: false,
    });
    expect(resolveGraphDowngrade("graph", { modelId: "m", embeddingDim: 2048 })).toEqual({
      indexMode: "graph",
      downgraded: false,
    });
  });

  it("downgrades graph to basic when dimension is below the minimum", () => {
    const r = resolveGraphDowngrade("graph", { modelId: "m", embeddingDim: 1024 });
    expect(r.indexMode).toBe("basic");
    expect(r.downgraded).toBe(true);
  });

  it("downgrades graph to basic when dimension is unknown (null/0)", () => {
    // This is the new-user root cause: dim not probed yet → unknown → must
    // not silently ship graph mode to the backend.
    const rNull = resolveGraphDowngrade("graph", { modelId: "m", embeddingDim: null });
    expect(rNull.indexMode).toBe("basic");
    expect(rNull.downgraded).toBe(true);

    const rZero = resolveGraphDowngrade("graph", { modelId: "m", embeddingDim: 0 });
    expect(rZero.downgraded).toBe(true);
  });

  it("isLightRAGCompatible agrees with the downgrade threshold", () => {
    expect(isLightRAGCompatible({ embeddingDim: LIGHTRAG_MIN_DIM })).toBe(true);
    expect(isLightRAGCompatible({ embeddingDim: LIGHTRAG_MIN_DIM - 1 })).toBe(false);
    expect(isLightRAGCompatible({ embeddingDim: null })).toBe(false);
    expect(isLightRAGCompatible({})).toBe(false);
  });
});

describe("graphDowngradeWarning", () => {
  it("mentions the model id, the actual dimension, and the minimum", () => {
    const msg = graphDowngradeWarning({ modelId: "text-embedding-v4", embeddingDim: 768 });
    expect(msg).toContain("text-embedding-v4");
    expect(msg).toContain("768");
    expect(msg).toContain(String(LIGHTRAG_MIN_DIM));
  });

  it("renders 'unknown' for a null/0 dimension", () => {
    expect(graphDowngradeWarning({ modelId: "m", embeddingDim: null })).toContain("unknown");
    expect(graphDowngradeWarning({ modelId: "m", embeddingDim: 0 })).toContain("unknown");
  });
});
