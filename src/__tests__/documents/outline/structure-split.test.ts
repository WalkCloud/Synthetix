import { describe, it, expect } from "vitest";
import { splitByStructure, loadStructure } from "@/lib/documents/outline/structure-split";
import type { StructureJson } from "@/lib/documents/atoms";

// Helper: build a StructureJson from section definitions.
function makeStructure(levels: Array<{ level: number; text: string }>): StructureJson {
  return {
    schema: "docling_structure_v1",
    sections: levels.map((s) => ({ label: "section_header", level: s.level, text: s.text, headingPath: "", page: null })),
  };
}

// Helper: build markdown that matches the sections.
function makeMarkdown(chapters: Array<{ title: string; body: string }>): string {
  let md = "**Cover Page**\n\n# Table of Contents\n\n1 First Chapter\t3\n2 Second Chapter\t10\n\n";
  for (const ch of chapters) {
    md += `## ${ch.title}\n\n${ch.body}\n\n`;
  }
  return md;
}

describe("splitByStructure", () => {
  it("splits a document into chapters using level-2 sections", () => {
    const md = makeMarkdown([
      { title: "First Chapter", body: "Content of the first chapter." },
      { title: "Second Chapter", body: "Content of the second chapter." },
      { title: "Third Chapter", body: "Content of the third chapter." },
    ]);
    const structure = makeStructure([
      { level: 2, text: "First Chapter" },
      { level: 3, text: "1.1 Subsection" },
      { level: 2, text: "Second Chapter" },
      { level: 2, text: "Third Chapter" },
    ]);

    const macros = splitByStructure(md, structure, 7372);

    expect(macros.length).toBe(3);
    expect(macros[0].headingPath).toBe("First Chapter");
    expect(macros[1].headingPath).toBe("Second Chapter");
    expect(macros[2].headingPath).toBe("Third Chapter");
  });

  it("produces clean headingPaths with no CLI noise", () => {
    // Even if the markdown contains CLI noise (# Keyspace, # 检查db),
    // the headingPath comes from structure.json sections, not markdown.
    const md = [
      "## 9 Chapter Nine\n\nSome content.\n\n",
      "# Keyspace\n\ndb0:keys=4890\n\n",
      "# 检查db情况\n\n127.0.0.1:6379> info\n\n",
      "## 10 Chapter Ten\n\nMore content.\n",
    ].join("");

    const structure = makeStructure([
      { level: 2, text: "9 Chapter Nine" },
      { level: 2, text: "10 Chapter Ten" },
    ]);

    const macros = splitByStructure(md, structure, 7372);

    expect(macros.length).toBe(2);
    expect(macros[0].headingPath).toBe("9 Chapter Nine");
    expect(macros[1].headingPath).toBe("10 Chapter Ten");
    // CLI noise is inside the content but NOT in headingPath
    expect(macros[0].content).toContain("Keyspace");
    expect(macros[0].content).toContain("检查db情况");
  });

  it("splits large chapters by level-3 subsections", () => {
    // Chapter with 3 subsections, each large enough to avoid coalescing.
    const longBody = "x".repeat(600);
    const md = [
      "## Big Chapter\n\n",
      `### 1.1 First Sub\n\n${longBody}\n\n`,
      `### 1.2 Second Sub\n\n${longBody}\n\n`,
      `### 1.3 Third Sub\n\n${longBody}\n\n`,
      "## Next Chapter\n\nEnd.\n",
    ].join("");

    const structure = makeStructure([
      { level: 2, text: "Big Chapter" },
      { level: 3, text: "1.1 First Sub" },
      { level: 3, text: "1.2 Second Sub" },
      { level: 3, text: "1.3 Third Sub" },
      { level: 2, text: "Next Chapter" },
    ]);

    // chunkMaxTokens small enough that the whole chapter doesn't fit.
    const macros = splitByStructure(md, structure, 400);

    // Should have at least 3 subsection chunks + 1 for "Next Chapter"
    expect(macros.length).toBeGreaterThanOrEqual(3);
    // All macros in "Big Chapter" should have the chapter in headingPath
    for (const m of macros) {
      if (m.h1 === "Big Chapter") {
        expect(m.headingPath).toContain("Big Chapter");
      }
    }
    expect(macros.some((m) => m.headingPath === "Next Chapter")).toBe(true);
  });

  it("skips cover page and TOC content before first chapter", () => {
    const md = "**Cover**\n\n# TOC\n\n1 Intro\t3\n\n## 1 Intro\n\nReal content.\n";
    const structure = makeStructure([{ level: 2, text: "1 Intro" }]);

    const macros = splitByStructure(md, structure, 7372);

    expect(macros.length).toBe(1);
    expect(macros[0].headingPath).toBe("1 Intro");
    expect(macros[0].content).not.toContain("Cover");
    expect(macros[0].content).not.toContain("TOC");
    expect(macros[0].content).toContain("Real content");
  });

  it("handles single-chapter document as one chunk", () => {
    const md = "## Only Chapter\n\nThe only content here.\n";
    const structure = makeStructure([{ level: 2, text: "Only Chapter" }]);

    const macros = splitByStructure(md, structure, 7372);

    expect(macros.length).toBe(1);
    expect(macros[0].headingPath).toBe("Only Chapter");
  });

  it("returns empty array for empty structure", () => {
    expect(splitByStructure("## Test", { sections: [] }, 7372)).toEqual([]);
  });

  it("returns empty array when no sections match markdown", () => {
    const structure = makeStructure([{ level: 2, text: "Nonexistent Chapter" }]);
    expect(splitByStructure("completely different text", structure, 7372)).toEqual([]);
  });

  it("coalesces tiny subsections into parent chapter", () => {
    const md = [
      "## Chapter\n\n",
      "### 1.1 Tiny\n\nshort\n\n",
      "### 1.2 Also Tiny\n\nbrief\n\n",
      "### 1.3 Substantial\n\n",
      "x".repeat(500),
      "\n\n## Next\n\nend\n",
    ].join("");

    const structure = makeStructure([
      { level: 2, text: "Chapter" },
      { level: 3, text: "1.1 Tiny" },
      { level: 3, text: "1.2 Also Tiny" },
      { level: 3, text: "1.3 Substantial" },
      { level: 2, text: "Next" },
    ]);

    const macros = splitByStructure(md, structure, 7372);

    // Tiny subsections (< MIN_CHUNK_TOKENS=100) should be coalesced.
    expect(macros.length).toBeLessThan(5);
  });
});

describe("loadStructure", () => {
  it("returns null for null path", async () => {
    expect(await loadStructure(null)).toBe(null);
  });

  it("returns null for nonexistent file", async () => {
    expect(await loadStructure("/nonexistent/path/structure.json")).toBe(null);
  });
});
