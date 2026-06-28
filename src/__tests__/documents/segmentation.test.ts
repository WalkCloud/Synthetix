import { describe, expect, it } from "vitest";

import { buildDocumentAtoms, type DocumentAtomRecord } from "@/lib/documents/atoms";
import {
  parsePlanResponse,
  validateAndBuildSegments,
  fallbackTokenBucketSegments,
  refineBoundaries,
  type LlmSegmentationPlan,
  type RefinedSegment,
} from "@/lib/documents/segmentation";

// Build a synthetic atom list so we don't depend on markdown parsing here.
function synthAtoms(count: number, tokensPerAtom = 100, headingEvery = 10): DocumentAtomRecord[] {
  const atoms: DocumentAtomRecord[] = [];
  for (let i = 0; i < count; i++) {
    const isHeading = i % headingEvery === 0;
    atoms.push({
      spanId: `s_${String(i).padStart(4, "0")}`,
      index: i,
      blockType: isHeading ? "heading" : "paragraph",
      content: isHeading ? `Heading ${i}` : `Paragraph content ${i} `.repeat(8),
      tokenCount: tokensPerAtom,
      headingPath: isHeading ? `Section ${i}` : `Section ${Math.floor(i / headingEvery) * headingEvery}`,
      headingLevel: isHeading ? 2 : null,
      pageStart: Math.floor(i / 5),
      pageEnd: Math.floor(i / 5),
      charStart: i * 200,
      charEnd: i * 200 + 180,
      textPreview: isHeading ? `Heading ${i}` : `Paragraph ${i}`,
    });
  }
  return atoms;
}

describe("parsePlanResponse", () => {
  it("parses a well-formed JSON plan", () => {
    const plan = parsePlanResponse(JSON.stringify({
      documentType: "research paper",
      language: "en",
      segmentationStrategy: "domain-based",
      segments: [{ title: "Methods", startWindowIndex: 0, endWindowIndex: 2, startAtomHint: 0, endAtomHint: 30, confidence: 0.9 }],
    }));
    expect(plan?.documentType).toBe("research paper");
    expect(plan?.segments).toHaveLength(1);
  });

  it("extracts JSON from markdown code fences", () => {
    const plan = parsePlanResponse('```json\n{"documentType":"x","language":"en","segmentationStrategy":"d","segments":[]}\n```');
    expect(plan?.documentType).toBe("x");
  });

  it("tolerates trailing commas via lenient repair", () => {
    const plan = parsePlanResponse('{"documentType":"x","language":"en","segmentationStrategy":"d","segments":[{"title":"a","startWindowIndex":0,"endWindowIndex":1,"startAtomHint":0,"endAtomHint":5,}]}');
    expect(plan?.segments).toHaveLength(1);
  });

  it("returns null on garbage", () => {
    expect(parsePlanResponse("not json at all")).toBeNull();
    expect(parsePlanResponse('{"foo":"bar"}')).toBeNull(); // no segments array
  });
});

describe("validateAndBuildSegments", () => {
  it("forces full coverage: starts at 0, ends at last atom, no gaps", () => {
    const atoms = synthAtoms(50);
    const refined: RefinedSegment[] = [
      { title: "A", startAtomIndex: 2, endAtomIndex: 15, confidence: 0.9 },
      { title: "B", startAtomIndex: 18, endAtomIndex: 40, confidence: 0.8 },
      { title: "C", startAtomIndex: 42, endAtomIndex: 48, confidence: 0.7 },
    ];
    const segments = validateAndBuildSegments(refined, atoms);
    expect(segments[0].startAtomIndex).toBe(0);
    expect(segments[segments.length - 1].endAtomIndex).toBe(49);
    // No gaps/overlaps between consecutive segments.
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startAtomIndex).toBe(segments[i - 1].endAtomIndex + 1);
    }
    // Coverage = 1.0
    const covered = segments.reduce((s, seg) => s + (seg.endAtomIndex - seg.startAtomIndex + 1), 0);
    expect(covered).toBe(50);
  });

  it("merges too-small segments into the previous one", () => {
    const atoms = synthAtoms(40, 100); // 100 tokens/atom → 4 tokens too small threshold is 300
    // A tiny segment of 2 atoms (200 tokens < 300 min) should merge into prior.
    const refined: RefinedSegment[] = [
      { title: "A", startAtomIndex: 0, endAtomIndex: 10, confidence: 0.9 },
      { title: "tiny", startAtomIndex: 11, endAtomIndex: 12, confidence: 0.5 },
      { title: "C", startAtomIndex: 13, endAtomIndex: 39, confidence: 0.8 },
    ];
    const segments = validateAndBuildSegments(refined, atoms);
    // The tiny segment should have been absorbed (fewer than 3 segments).
    expect(segments.length).toBeLessThan(3);
  });

  it("returns [] for an empty refined list", () => {
    expect(validateAndBuildSegments([], synthAtoms(10))).toEqual([]);
  });
});

describe("fallbackTokenBucketSegments", () => {
  it("always achieves full coverage", () => {
    const atoms = synthAtoms(60, 100);
    const segments = fallbackTokenBucketSegments(atoms);
    const covered = segments.reduce((s, seg) => s + (seg.endAtomIndex - seg.startAtomIndex + 1), 0);
    expect(covered).toBe(60);
    expect(segments[0].startAtomIndex).toBe(0);
    expect(segments[segments.length - 1].endAtomIndex).toBe(59);
  });

  it("produces contiguous, non-overlapping segments", () => {
    const atoms = synthAtoms(40, 100);
    const segments = fallbackTokenBucketSegments(atoms);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startAtomIndex).toBe(segments[i - 1].endAtomIndex + 1);
    }
  });

  it("every segment has a non-empty summary (used as graph prefix)", () => {
    const atoms = synthAtoms(30, 100);
    const segments = fallbackTokenBucketSegments(atoms);
    for (const s of segments) {
      expect(s.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("refineBoundaries", () => {
  it("produces contiguous segments from a window-based plan", () => {
    const atoms = synthAtoms(30, 100, 5);
    // Build 2 windows manually covering all atoms.
    const windows = [
      { index: 0, startAtomIndex: 0, endAtomIndex: 14, tokenCount: 1500, blockTypeCounts: {}, leadingHeadingPath: null, previews: [] },
      { index: 1, startAtomIndex: 15, endAtomIndex: 29, tokenCount: 1500, blockTypeCounts: {}, leadingHeadingPath: null, previews: [] },
    ];
    const plan: LlmSegmentationPlan = {
      documentType: "manual",
      language: "en",
      segmentationStrategy: "domain-based",
      segments: [
        { title: "Part 1", startWindowIndex: 0, endWindowIndex: 0, startAtomHint: 0, endAtomHint: 14, confidence: 0.9 },
        { title: "Part 2", startWindowIndex: 1, endWindowIndex: 1, startAtomHint: 15, endAtomHint: 29, confidence: 0.9 },
      ],
    };
    const { segments } = refineBoundaries(plan, atoms, windows as never);
    expect(segments[0].startAtomIndex).toBe(0);
    expect(segments[1].endAtomIndex).toBe(29);
    expect(segments[1].startAtomIndex).toBeGreaterThanOrEqual(segments[0].endAtomIndex);
  });
});

describe("buildDocumentAtoms → segmentation integration (end-to-end coverage)", () => {
  it("fallback segmentation of real atoms covers the whole document", () => {
    const md = Array.from({ length: 20 }, (_, i) =>
      `# Chapter ${i + 1}\n\n${"This is paragraph content. ".repeat(40)}`
    ).join("\n\n");
    const atoms = buildDocumentAtoms(md);
    const segments = fallbackTokenBucketSegments(atoms);
    const covered = segments.reduce((s, seg) => s + (seg.endAtomIndex - seg.startAtomIndex + 1), 0);
    expect(covered).toBe(atoms.length);
  });
});
