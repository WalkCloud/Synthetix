import { describe, it, expect } from "vitest";
import { EN_PROMPTS } from "@/lib/prompts/locales/en-prompts";
import { ZH_PROMPTS } from "@/lib/prompts/locales/zh-CN-prompts";

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

  describe("Facilitator prompt markers", () => {
    const markers = [
      "NEEDS_GATHERED",
      "DIRECTION_CONFIRMED",
      "GENERATE_DIRECT",
      "SECTION_BY_SECTION",
      "ALL_SECTIONS_CONFIRMED",
    ];

    it("EN facilitator contains all markers", () => {
      for (const marker of markers) {
        expect(EN_PROMPTS.facilitator).toContain(marker);
      }
    });

    it("ZH facilitator contains all markers", () => {
      for (const marker of markers) {
        expect(ZH_PROMPTS.facilitator).toContain(marker);
      }
    });
  });

  describe("Outline prompt structural elements", () => {
    const archetypes = [
      "technical_solution",
      "proposal",
      "bidding",
      "consulting",
      "planning",
      "assessment",
      "operations",
      "general",
    ];

    it("EN outline mentions all archetypes", () => {
      for (const archetype of archetypes) {
        expect(EN_PROMPTS.outline).toContain(archetype);
      }
    });

    it("ZH outline mentions all archetypes", () => {
      for (const archetype of archetypes) {
        expect(ZH_PROMPTS.outline).toContain(archetype);
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

  describe("Writing system prompt key rules", () => {
    it("EN writing system mentions diagram syntax", () => {
      expect(EN_PROMPTS.writingSystem).toContain("DIAGRAM_REQUEST");
    });

    it("ZH writing system mentions diagram syntax", () => {
      expect(ZH_PROMPTS.writingSystem).toContain("DIAGRAM_REQUEST");
    });

    it("EN writing system mentions hard-banned words", () => {
      expect(EN_PROMPTS.writingSystem).toContain("HARD-BANNED");
    });

    it("ZH writing system mentions hard-banned words", () => {
      expect(ZH_PROMPTS.writingSystem).toContain("禁用词汇");
    });
  });
});
