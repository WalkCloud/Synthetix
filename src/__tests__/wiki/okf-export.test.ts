import { describe, expect, it } from "vitest";

import { entryToOkfMarkdown } from "@/lib/wiki/index-md";
import { WIKI_CONFIG, resolveWikiInputMaxTokens } from "@/lib/wiki/types";

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
    expect(WIKI_CONFIG.entryContentCharLimit).toBeLessThanOrEqual(5000);
  });
});

describe("resolveWikiInputMaxTokens (dynamic Phase-A input cap)", () => {
  it("scales with the writing model's context window (no longer fixed at 2000)", () => {
    // A modern 200K-window model should get a far larger cap than the old fixed 2000.
    const cap = resolveWikiInputMaxTokens(200000);
    expect(cap).toBeGreaterThan(2000);
    expect(cap).toBe(Math.floor(200000 * 0.08)); // 16000
  });

  it("respects the configured ceiling (WIKI_INPUT_MAX_TOKENS)", () => {
    // Huge context window must not exceed the 16K ceiling.
    expect(resolveWikiInputMaxTokens(1_000_000)).toBe(16000);
  });

  it("respects the 4000 floor for small-context models", () => {
    // A tiny 4K-context model still gets the floor, never below.
    expect(resolveWikiInputMaxTokens(4096)).toBe(4000);
  });

  it("falls back to 200K default when contextWindow is 0/unset", () => {
    expect(resolveWikiInputMaxTokens(0)).toBe(16000);
  });
});
