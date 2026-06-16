import { describe, it, expect } from "vitest";
import { EN_PROMPTS } from "@/lib/prompts/locales/en-prompts";
import { ZH_PROMPTS } from "@/lib/prompts/locales/zh-CN-prompts";
import { ARCHETYPE_IDS, getAllArchetypes } from "@/lib/brainstorm/archetypes";
import { buildFacilitatorPrompt } from "@/lib/prompts/builders/facilitator";
import { buildWritingContext } from "@/lib/prompts/builders/writing-context";

/**
 * Prompt snapshot parity tests.
 * Ensure zh-CN prompts have the same keys as en prompts,
 * and that critical structural elements are preserved.
 */
describe("Prompt localization parity", () => {
  it("zh-CN prompts have all the same keys as en prompts", () => {
    const enKeys = Object.keys(EN_PROMPTS).sort();
    const zhKeys = Object.keys(ZH_PROMPTS).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("no prompt is an empty string", () => {
    for (const [key, value] of Object.entries(EN_PROMPTS)) {
      expect(value.length, `EN prompt "${key}" should not be empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(ZH_PROMPTS)) {
      expect(value.length, `ZH prompt "${key}" should not be empty`).toBeGreaterThan(0);
    }
  });

  describe("Runtime prompt builders", () => {
    it("locale prompt maps no longer carry old giant runtime prompts", () => {
      expect("facilitator" in EN_PROMPTS).toBe(false);
      expect("facilitator" in ZH_PROMPTS).toBe(false);
      expect("writingSystem" in EN_PROMPTS).toBe(false);
      expect("writingSystem" in ZH_PROMPTS).toBe(false);
    });

    it("facilitator prompt markers are supplied by phase-specific builders", () => {
      expect(buildFacilitatorPrompt("en", "gathering")).toContain("NEEDS_GATHERED");
      expect(buildFacilitatorPrompt("zh-CN", "direction")).toContain("DIRECTION_CONFIRMED");
      expect(buildFacilitatorPrompt("en", "mode_select")).toContain("GENERATE_DIRECT");
      expect(buildFacilitatorPrompt("zh-CN", "section_refine")).toContain("ALL_SECTIONS_CONFIRMED");
    });

    it("writing prompts are supplied by conditional skill builders", () => {
      expect(buildWritingContext("en", { needsDiagram: false })).not.toContain("DIAGRAM_REQUEST");
      expect(buildWritingContext("zh-CN", { needsDiagram: true })).toContain("DIAGRAM_REQUEST");
      expect(buildWritingContext("en", { isParentSection: true })).toContain("child subsections");
      expect(buildWritingContext("zh-CN", { isParentSection: false })).toContain("叶子章节");
    });
  });

  describe("Outline archetype registry", () => {
    it("locale prompt maps no longer carry old outline prompts", () => {
      expect("outline" in EN_PROMPTS).toBe(false);
      expect("outline" in ZH_PROMPTS).toBe(false);
      expect("outlineRepair" in EN_PROMPTS).toBe(false);
      expect("outlineRepair" in ZH_PROMPTS).toBe(false);
    });

    it("registry contains all supported archetypes with bilingual text", () => {
      expect(ARCHETYPE_IDS).toEqual([
        "technical_solution",
        "proposal",
        "bidding",
        "consulting",
        "planning",
        "assessment",
        "operations",
        "general",
      ]);

      for (const archetype of getAllArchetypes()) {
        for (const key of ["label", "useWhen", "principle", "skeleton", "focus"] as const) {
          expect(archetype[key].en.length, `${archetype.id}.${key}.en`).toBeGreaterThan(0);
          expect(archetype[key]["zh-CN"].length, `${archetype.id}.${key}.zh-CN`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Audit prompt JSON format", () => {
    it("EN audit system prompt specifies JSON output", () => {
      expect(EN_PROMPTS.auditSystem).toContain("passed");
      expect(EN_PROMPTS.auditSystem).toContain("score");
      expect(EN_PROMPTS.auditSystem).toContain("issues");
    });

    it("ZH audit system prompt specifies JSON output", () => {
      expect(ZH_PROMPTS.auditSystem).toContain("passed");
      expect(ZH_PROMPTS.auditSystem).toContain("score");
      expect(ZH_PROMPTS.auditSystem).toContain("issues");
    });
  });
});
