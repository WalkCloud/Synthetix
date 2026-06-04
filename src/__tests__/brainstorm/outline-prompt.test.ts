import { describe, expect, it } from "vitest";
import { composeArchetypeKey } from "@/lib/brainstorm/archetypes";
import { buildLightweightOutlinePrompt } from "@/lib/brainstorm/outline-prompt";
import { buildSummaryPrompt } from "@/lib/brainstorm/summary-prompt";

describe("buildLightweightOutlinePrompt", () => {
  it("includes only the requested primary archetype skeleton", () => {
    const prompt = buildLightweightOutlinePrompt("technical_solution", "en");

    expect(prompt).toContain("Document Archetype: technical_solution");
    expect(prompt).toContain("architecture-first");
    expect(prompt).toContain("writingRequirements");
    expect(prompt).toContain("retrievalQuery");
    expect(prompt).toContain("referenceHints");
    expect(prompt).not.toContain("Investment Estimate");
    expect(prompt).not.toContain("Emergency Response");
    expect(prompt.length).toBeLessThan(4500);
  });

  it("includes only primary and secondary skeletons for hybrid documents", () => {
    const prompt = buildLightweightOutlinePrompt("technical_solution+planning", "en");

    expect(prompt).toContain("Document Archetype: technical_solution");
    expect(prompt).toContain('secondary archetype "planning"');
    expect(prompt).toContain("Phased Roadmap");
    expect(prompt).not.toContain("After-Sales & Training");
    expect(prompt).not.toContain("Evaluation Standards");
    expect(prompt.length).toBeLessThan(5500);
  });

  it("uses Chinese skeletons for zh-CN output", () => {
    const prompt = buildLightweightOutlinePrompt("technical_solution+planning", "zh-CN");

    expect(prompt).toContain("文档原型：technical_solution");
    expect(prompt).toContain("先架构后细节");
    expect(prompt).toContain("分阶段路线图");
    expect(prompt).not.toContain("After-Sales & Training");
  });

  it("falls back invalid primary archetypes to general and ignores invalid secondary archetypes", () => {
    expect(buildLightweightOutlinePrompt("missing", "en")).toContain("Document Archetype: general");
    expect(buildLightweightOutlinePrompt("technical_solution+missing", "en")).not.toContain("hybrid document");
  });
});

describe("summary prompt archetype choices", () => {
  it("uses registry choices for both locales", () => {
    expect(buildSummaryPrompt("en")).toContain("technical_solution (Construction / Implementation");
    expect(buildSummaryPrompt("en")).toContain("general (General Professional Documents)");
    expect(buildSummaryPrompt("zh-CN")).toContain("technical_solution (建设/实施方案)");
    expect(buildSummaryPrompt("zh-CN")).toContain("general (通用专业文档)");
  });

  it("supports worker-style hybrid composition", () => {
    expect(composeArchetypeKey("technical_solution", "planning")).toBe("technical_solution+planning");
    expect(composeArchetypeKey("technical_solution", null)).toBe("technical_solution");
  });
});
