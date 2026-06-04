import { describe, expect, it } from "vitest";
import { normalizeGeneratedOutline } from "@/lib/brainstorm/outline-normalizer";

describe("normalizeGeneratedOutline", () => {
  it("rebuilds dotted flat sections into children", () => {
    const outline = normalizeGeneratedOutline({
      title: "Technical Proposal",
      documentType: "technical_solution",
      sections: [
        { num: "1", title: "Overview", estimatedWords: 600 },
        { num: "1.1", title: "Background", estimatedWords: 300 },
        { num: "1.2", title: "Scope", estimatedWords: 300 },
        { num: "2", title: "Design", estimatedWords: 900 },
        { num: "2.1", title: "Architecture", estimatedWords: 400 },
      ],
    });

    expect(outline.sections).toHaveLength(2);
    expect(outline.sections[0].num).toBe("1");
    expect(outline.sections[0].children?.map((section) => section.num)).toEqual(["1.1", "1.2"]);
    expect(outline.sections[1].children?.[0].title).toBe("Architecture");
  });

  it("preserves nested sections and renumbers them consistently", () => {
    const outline = normalizeGeneratedOutline({
      title: "Plan",
      sections: [
        {
          num: "3",
          title: "Implementation",
          children: [
            { num: "3.7", title: "Milestones" },
            { num: "3.8", title: "Risks" },
          ],
        },
      ],
    });

    expect(outline.sections[0].num).toBe("1");
    expect(outline.sections[0].children?.map((section) => section.num)).toEqual(["1.1", "1.2"]);
  });

  it("recognizes common child section aliases", () => {
    const outline = normalizeGeneratedOutline({
      title: "Aliased Children",
      sections: [
        {
          num: "1",
          title: "Implementation",
          subsections: [
            { num: "1.1", title: "Milestones" },
            { num: "1.2", title: "Risks" },
          ],
        },
      ],
    });

    expect(outline.sections[0].children?.map((section) => section.title)).toEqual(["Milestones", "Risks"]);
  });

  it("rebuilds dotted hierarchy even when children appear before parents", () => {
    const outline = normalizeGeneratedOutline({
      title: "Out of Order",
      sections: [
        { num: "1.1", title: "Background" },
        { num: "1", title: "Overview" },
        { num: "2.1", title: "Architecture" },
        { num: "2", title: "Design" },
      ],
    });

    expect(outline.sections).toHaveLength(2);
    expect(outline.sections[0].title).toBe("Overview");
    expect(outline.sections[0].children?.[0].title).toBe("Background");
    expect(outline.sections[1].title).toBe("Design");
    expect(outline.sections[1].children?.[0].title).toBe("Architecture");
  });

  it("throws for invalid outline objects", () => {
    expect(() => normalizeGeneratedOutline({ title: "", sections: [] })).toThrow("Outline title is required");
    expect(() => normalizeGeneratedOutline({ title: "x", sections: [] })).toThrow("Outline must contain at least one section");
  });
});
