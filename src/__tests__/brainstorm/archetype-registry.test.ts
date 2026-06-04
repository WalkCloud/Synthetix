import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_IDS,
  composeArchetypeKey,
  getAllArchetypes,
  getArchetypeChoices,
  getArchetypeSkeleton,
  normalizeArchetypeId,
} from "@/lib/brainstorm/archetypes";

describe("archetype registry", () => {
  it("registers all supported archetypes in stable order", () => {
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
  });

  it("contains complete bilingual fields for each archetype", () => {
    for (const archetype of getAllArchetypes()) {
      for (const field of ["label", "useWhen", "principle", "skeleton", "focus"] as const) {
        expect(archetype[field].en.trim(), `${archetype.id}.${field}.en`).not.toBe("");
        expect(archetype[field]["zh-CN"].trim(), `${archetype.id}.${field}.zh-CN`).not.toBe("");
      }
    }
  });

  it("returns locale-specific skeleton data", () => {
    expect(getArchetypeSkeleton("technical_solution", "en")?.principle).toContain("architecture-first");
    expect(getArchetypeSkeleton("technical_solution", "zh-CN")?.principle).toContain("先架构后细节");
  });

  it("normalizes and composes hybrid archetype keys", () => {
    expect(normalizeArchetypeId("planning")).toBe("planning");
    expect(normalizeArchetypeId("missing")).toBeNull();
    expect(composeArchetypeKey("technical_solution", "planning")).toBe("technical_solution+planning");
    expect(composeArchetypeKey("technical_solution", "technical_solution")).toBe("technical_solution");
    expect(composeArchetypeKey("missing", "planning")).toBe("general+planning");
    expect(composeArchetypeKey("technical_solution", "missing")).toBe("technical_solution");
  });

  it("builds localized summary choices from the registry", () => {
    expect(getArchetypeChoices("en")).toContain("technical_solution");
    expect(getArchetypeChoices("en")).toContain("Construction / Implementation");
    expect(getArchetypeChoices("zh-CN")).toContain("technical_solution");
    expect(getArchetypeChoices("zh-CN")).toContain("建设/实施方案");
  });
});
