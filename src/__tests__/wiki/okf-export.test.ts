import { describe, expect, it } from "vitest";

import { entryToOkfMarkdown } from "@/lib/wiki/index-md";
import { WIKI_CONFIG } from "@/lib/wiki/types";

describe("entryToOkfMarkdown (OKF export format)", () => {
  it("produces minimal YAML frontmatter with type + body", () => {
    const md = entryToOkfMarkdown({
      type: "topic",
      title: "Microservice Communication",
      slug: "microservice-communication",
      content: "Synchronous vs async patterns.",
      confidence: 0.85,
      updatedAt: new Date("2026-06-22T10:00:00Z"),
    });

    // OKF spec: minimal frontmatter with at least `type`, then Markdown body
    expect(md).toContain("---");
    expect(md).toContain("type: topic");
    expect(md).toContain("confidence: 0.85");
    expect(md).toContain("Microservice Communication");
    expect(md).toContain("Synchronous vs async patterns.");
  });

  it("quotes titles containing special characters in frontmatter", () => {
    const md = entryToOkfMarkdown({
      type: "claim",
      title: "Test: it works!",
      slug: "test-it-works",
      content: "Body",
      confidence: 0.9,
      updatedAt: new Date("2026-06-22T10:00:00Z"),
    });
    // Title with special chars should be JSON-quoted for valid YAML
    expect(md).toContain('title: "Test: it works!"');
  });

  it("ends with a newline (portable file convention)", () => {
    const md = entryToOkfMarkdown({
      type: "concept",
      title: "T",
      slug: "t",
      content: "C",
      confidence: 0.5,
      updatedAt: new Date("2026-06-22T10:00:00Z"),
    });
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("WIKI_CONFIG tunables", () => {
  it("keeps chunk token budget within typical context windows", () => {
    // Even a small 4k-context model should fit one chunk + titles list
    expect(WIKI_CONFIG.chunkMaxTokens).toBeLessThanOrEqual(4000);
    expect(WIKI_CONFIG.titlesListMaxTokens).toBeLessThanOrEqual(1000);
  });

  it("has a reasonable duplicate threshold (not too aggressive, not too lax)", () => {
    expect(WIKI_CONFIG.duplicateTitleThreshold).toBeGreaterThanOrEqual(0.3);
    expect(WIKI_CONFIG.duplicateTitleThreshold).toBeLessThanOrEqual(0.7);
  });

  it("caps entry content to keep Wiki modular (OKF principle: small files)", () => {
    expect(WIKI_CONFIG.entryContentCharLimit).toBeGreaterThan(100);
    expect(WIKI_CONFIG.entryContentCharLimit).toBeLessThanOrEqual(2000);
  });
});
