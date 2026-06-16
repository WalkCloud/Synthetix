import { describe, it, expect } from "vitest";
import { enforceEmbeddingSafeChunks } from "@/lib/documents/outline/guard";
import type { SplitChunk } from "@/lib/documents/splitter";

function makeChunk(overrides: Partial<SplitChunk> & { content: string }): SplitChunk {
  return {
    index: overrides.index ?? 0,
    title: overrides.title ?? "Test",
    content: overrides.content,
    tokenCount: overrides.tokenCount ?? Math.ceil(overrides.content.length / 1.5),
    headingPath: overrides.headingPath ?? "Test",
  };
}

describe("enforceEmbeddingSafeChunks", () => {
  it("passes through chunks within limit", async () => {
    const chunk = makeChunk({ content: "Hello world" });
    const result = await enforceEmbeddingSafeChunks([chunk], 1000);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello world");
  });

  it("splits oversize chunk into parts by lines", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: ${"x".repeat(30)}`);
    const content = lines.join("\n");
    const chunk = makeChunk({ content, title: "Big Section", headingPath: "Big Section" });
    const maxTokens = 100;

    const result = await enforceEmbeddingSafeChunks([chunk], maxTokens);
    expect(result.length).toBeGreaterThan(1);
    for (const r of result) {
      expect(r.tokenCount).toBeLessThanOrEqual(maxTokens + 5);
      expect(r.content.length).toBeGreaterThan(0);
    }
    expect(result[0].title).toContain("Big Section (part 1/");
  });

  it("force-truncates single-line oversize chunk instead of faking tokenCount", async () => {
    const longContent = "x".repeat(20000);
    const chunk = makeChunk({ content: longContent, tokenCount: 15000 });
    const maxTokens = 500;

    const result = await enforceEmbeddingSafeChunks([chunk], maxTokens);
    expect(result).toHaveLength(1);
    expect(result[0].content.length).toBeLessThan(longContent.length);
    expect(result[0].tokenCount).toBeLessThanOrEqual(maxTokens + 5);
  });

  it("preserves headingPath in split sub-chunks", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: ${"y".repeat(30)}`);
    const content = lines.join("\n");
    const chunk = makeChunk({ content, title: "Section", headingPath: "Root > Section" });
    const maxTokens = 100;

    const result = await enforceEmbeddingSafeChunks([chunk], maxTokens);
    for (const r of result) {
      expect(r.headingPath).toBe("Root > Section");
    }
  });

  it("splits an oversized markdown table, repeating the header on each fragment", async () => {
    const header = "| 列A | 列B |";
    const sep = "|---|---|";
    const rows = Array.from({ length: 80 }, (_, i) => `| 数据${i} | ${"内容".repeat(18)} |`);
    const content = `[章节 > 表]\n${header}\n${sep}\n${rows.join("\n")}`;
    const chunk = makeChunk({ content, title: "表", headingPath: "章节 > 表" });
    const maxTokens = 200;

    const result = await enforceEmbeddingSafeChunks([chunk], maxTokens);
    expect(result.length).toBeGreaterThan(1);
    for (const r of result) {
      // every fragment stays within budget
      expect(r.tokenCount).toBeLessThanOrEqual(maxTokens + 10);
      // every fragment must be a valid self-describing table (header + separator present)
      expect(r.content).toContain(header);
      expect(r.content).toContain(sep);
    }
  });

  it("splits a chunk whose stored tokenCount was under-estimated but content is genuinely over the limit", async () => {
    // Simulate micro-split's len/2 under-estimate: real tokens (len/1.5) exceed
    // the limit, but the incoming tokenCount claims it fits. The guard must
    // re-measure and split regardless of the stale low tokenCount.
    const lines = Array.from(
      { length: 60 },
      (_, i) => `第${i}行${"文字内容".repeat(7)}`,
    );
    const content = lines.join("\n");
    const realTokens = Math.ceil(content.length / 1.5);
    const underestimated = Math.ceil(content.length / 2); // len/2, what micro-split stores
    const maxTokens = 1000;
    expect(underestimated).toBeLessThan(maxTokens); // would slip through the old guard
    expect(realTokens).toBeGreaterThan(maxTokens); // actually over the limit

    const chunk = makeChunk({ content, tokenCount: underestimated });
    const result = await enforceEmbeddingSafeChunks([chunk], maxTokens);
    expect(result.length).toBeGreaterThan(1); // got split despite the low incoming tokenCount
    for (const r of result) {
      expect(r.tokenCount).toBeLessThanOrEqual(maxTokens + 5);
    }
  });
});
