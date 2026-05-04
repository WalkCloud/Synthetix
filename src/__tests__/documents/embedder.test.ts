import { describe, it, expect } from "vitest";
import { cosineSimilarity, float32ToBuffer, bufferToFloat32 } from "@/lib/documents/embedder";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("returns 0 for zero vectors", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles mismatched lengths", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("float32ToBuffer / bufferToFloat32", () => {
  it("roundtrips correctly", () => {
    const original = new Float32Array([1.5, -2.3, 3.14, 0]);
    const buffer = float32ToBuffer(original);
    const restored = bufferToFloat32(buffer);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});
