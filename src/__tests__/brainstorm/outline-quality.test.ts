import { describe, expect, it } from "vitest";
import { evaluateOutlineQuality } from "@/lib/brainstorm/outline-quality";

describe("evaluateOutlineQuality", () => {
  it("rejects a shallow outline with only top-level headings", () => {
    const result = evaluateOutlineQuality({
      title: "Simple Plan",
      sections: [
        { num: "1", title: "Background" },
        { num: "2", title: "Goals" },
        { num: "3", title: "Implementation" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Expected at least 4 top-level sections, got 3");
    expect(result.issues).toContain("Expected hierarchy depth of at least 2, got 1");
  });

  it("accepts a nested outline with enough leaf sections", () => {
    const result = evaluateOutlineQuality({
      title: "Detailed Plan",
      sections: [
        {
          num: "1",
          title: "Overview",
          children: [
            { num: "1.1", title: "Context", description: "Scope", keyPoints: ["A"], estimatedWords: 400 },
            { num: "1.2", title: "Objectives", description: "Scope", keyPoints: ["A"], estimatedWords: 400 },
          ],
        },
        {
          num: "2",
          title: "Requirements",
          children: [
            { num: "2.1", title: "Business", description: "Scope", keyPoints: ["A"], estimatedWords: 500 },
            { num: "2.2", title: "Technical", description: "Scope", keyPoints: ["A"], estimatedWords: 500 },
          ],
        },
        {
          num: "3",
          title: "Solution",
          children: [
            { num: "3.1", title: "Architecture", description: "Scope", keyPoints: ["A"], estimatedWords: 600 },
            { num: "3.2", title: "Modules", description: "Scope", keyPoints: ["A"], estimatedWords: 600 },
          ],
        },
        {
          num: "4",
          title: "Delivery",
          children: [
            { num: "4.1", title: "Plan", description: "Scope", keyPoints: ["A"], estimatedWords: 500 },
            { num: "4.2", title: "Risks", description: "Scope", keyPoints: ["A"], estimatedWords: 500 },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.leafCount).toBe(8);
    expect(result.maxDepth).toBe(2);
  });

  it("raises the leaf threshold for long documents", () => {
    const outline = {
      title: "Long Report",
      sections: Array.from({ length: 4 }, (_, sectionIndex) => ({
        num: String(sectionIndex + 1),
        title: `Chapter ${sectionIndex + 1}`,
        children: Array.from({ length: 3 }, (_, childIndex) => ({
          num: `${sectionIndex + 1}.${childIndex + 1}`,
          title: `Topic ${childIndex + 1}`,
          description: "Scope",
          keyPoints: ["A"],
          estimatedWords: 700,
        })),
      })),
    };

    const result = evaluateOutlineQuality(outline, { lengthHint: "10,000+ words" });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Expected at least 15 leaf sections, got 12");
  });

  it("reports leaf sections missing drafting metadata", () => {
    const result = evaluateOutlineQuality({
      title: "Metadata Check",
      sections: [
        {
          num: "1",
          title: "Chapter 1",
          children: [
            { num: "1.1", title: "Topic 1", estimatedWords: 300 },
            { num: "1.2", title: "Topic 2", description: "Scope", estimatedWords: 300 },
          ],
        },
        { num: "2", title: "Chapter 2", children: [{ num: "2.1", title: "Topic 3", description: "Scope", keyPoints: ["A"] }] },
        { num: "3", title: "Chapter 3", children: [{ num: "3.1", title: "Topic 4", description: "Scope", keyPoints: ["A"] }] },
        { num: "4", title: "Chapter 4", children: [{ num: "4.1", title: "Topic 5", description: "Scope", keyPoints: ["A"] }] },
      ],
    }, { minLeafCount: 5 });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("1 leaf section is missing description");
    expect(result.issues).toContain("2 leaf sections are missing keyPoints");
  });

  it("skips detail-field checks at the skeleton stage (checkDetailFields:false)", () => {
    // A skeleton from Stage 1: valid structure but no keyPoints/description (added later by enrichment).
    const skeleton = {
      title: "Container Cloud Platform Plan",
      sections: [
        { num: "1", title: "Background", children: [
          { num: "1.1", title: "Drivers", estimatedWords: 400 },
          { num: "1.2", title: "Goals", estimatedWords: 400 },
        ]},
        { num: "2", title: "Architecture", children: [
          { num: "2.1", title: "Overall", estimatedWords: 500 },
          { num: "2.2", title: "Tech Stack", estimatedWords: 500 },
        ]},
        { num: "3", title: "Security", children: [
          { num: "3.1", title: "Compliance", estimatedWords: 500 },
          { num: "3.2", title: "Isolation", estimatedWords: 500 },
        ]},
        { num: "4", title: "Operations", children: [
          { num: "4.1", title: "Monitoring", estimatedWords: 500 },
          { num: "4.2", title: "Disaster Recovery", estimatedWords: 500 },
        ]},
      ],
    };

    // Default (full check): skeleton has no keyPoints/description -> fails.
    const fullResult = evaluateOutlineQuality(skeleton);
    expect(fullResult.ok).toBe(false);
    expect(fullResult.issues).toContain("8 leaf sections are missing description");
    expect(fullResult.issues).toContain("8 leaf sections are missing keyPoints");

    // Skeleton stage (structure only): valid structure passes despite missing detail fields.
    const skeletonResult = evaluateOutlineQuality(skeleton, { checkDetailFields: false });
    expect(skeletonResult.ok).toBe(true);
    expect(skeletonResult.leafCount).toBe(8);
    expect(skeletonResult.maxDepth).toBe(2);
    expect(skeletonResult.issues.some((i) => i.includes("keyPoints"))).toBe(false);
    expect(skeletonResult.issues.some((i) => i.includes("description"))).toBe(false);
  });
});
