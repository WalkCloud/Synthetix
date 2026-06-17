import { describe, expect, it } from "vitest";
import { buildFacilitatorPrompt } from "@/lib/prompts/builders/facilitator";
import { buildDiagramPrompts } from "@/lib/prompts/builders/diagram";
import { buildWritingContext } from "@/lib/prompts/builders/writing-context";

describe("prompt skill builders", () => {
  it("builds a discovery prompt without unrelated later-stage markers", () => {
    const prompt = buildFacilitatorPrompt("en", "gathering");

    expect(prompt).toContain("NEEDS_GATHERED");
    expect(prompt).toContain("Do not ask about length together with other structural questions");
    expect(prompt).toContain("ask one final standalone length question");
    expect(prompt).toContain("A. [option title]");
    expect(prompt).toContain("D. Other");
    expect(prompt).not.toContain("DIRECTION_CONFIRMED");
    expect(prompt).not.toContain("ALL_SECTIONS_CONFIRMED");
  });

  it("builds a direction prompt focused on structure selection", () => {
    const prompt = buildFacilitatorPrompt("en", "direction");

    expect(prompt).toContain("outline direction selection");
    expect(prompt).toContain("provide one confirmable initial outline");
    expect(prompt).toContain("Do not offer multiple competing outline directions");
    expect(prompt).toContain("A. Generate the complete outline directly");
    expect(prompt).toContain("B. Discuss each section first");
    expect(prompt).toContain("DIRECTION_CONFIRMED");
    expect(prompt).not.toContain("ALL_SECTIONS_CONFIRMED");
  });

  it("builds a section refinement prompt without discovery dimensions", () => {
    const prompt = buildFacilitatorPrompt("en", "section_refine");

    expect(prompt).toContain("section-by-section refinement");
    expect(prompt).toContain("clear Markdown line breaks");
    expect(prompt).toContain("ALL_SECTIONS_CONFIRMED");
    expect(prompt).not.toContain("goal and audience");
  });

  it("builds localized Chinese discovery prompts with length and option formatting rules", () => {
    const prompt = buildFacilitatorPrompt("zh-CN", "gathering");

    expect(prompt).toContain("不要把篇幅/字数/页数和其他结构问题混在同一轮询问");
    expect(prompt).toContain("最后一个独立问题");
    expect(prompt).toContain("A. 【选项标题】");
    expect(prompt).toContain("D. 其他");
  });

  it("does not include diagram syntax for ordinary writing sections", () => {
    const prompt = buildWritingContext("en", { needsDiagram: false, isParentSection: false });

    expect(prompt).not.toContain("DIAGRAM_REQUEST");
    expect(prompt).toContain("leaf section");
  });

  it("includes diagram syntax only when requested by section context", () => {
    const prompt = buildWritingContext("en", { needsDiagram: true, isParentSection: false });

    expect(prompt).toContain("DIAGRAM_REQUEST");
    expect(prompt).toContain("leaf section");
  });

  it("describes topology diagram requests without forcing flow arrows", () => {
    const prompt = buildWritingContext("en", { needsDiagram: true, isParentSection: false });

    expect(prompt).toContain("relationships=<");
    expect(prompt).toContain("groups=<");
    expect(prompt).toContain("boundaries=<");
    expect(prompt).not.toContain("flows=<comma-separated relationships using ->>");
  });

  it("lets architecture diagrams use containers without requiring every edge to be a flow", () => {
    const prompts = buildDiagramPrompts("en");

    expect(prompts.create).toContain("For architecture, deployment, and topology diagrams");
    expect(prompts.create).toContain("containers");
    expect(prompts.create).not.toContain("Every arrow needs a meaningful flow type and label.");
  });

  it("uses parent overview rules for parent sections", () => {
    const prompt = buildWritingContext("en", { needsDiagram: false, isParentSection: true });

    expect(prompt).toContain("child subsections");
    expect(prompt).not.toContain("leaf section");
  });

  it("builds localized Chinese writing prompts from the same skill set", () => {
    const prompt = buildWritingContext("zh-CN", { needsDiagram: true, isParentSection: true });

    expect(prompt).toContain("图表语法");
    expect(prompt).toContain("子章节");
    expect(prompt).toContain("参考资料处理");
  });
});
