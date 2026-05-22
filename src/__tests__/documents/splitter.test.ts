import { describe, it, expect } from "vitest";
import { splitMarkdown, estimateTokens } from "@/lib/documents/splitter";

const largeDoc = `# Chapter 1

This is the first chapter. ${"Lorem ipsum dolor sit amet. ".repeat(100)}

## Section 1.1

More content. ${"Consectetur adipiscing elit. ".repeat(100)}

## Section 1.2

Another section. ${"Sed do eiusmod tempor. ".repeat(100)}

# Chapter 2

Second chapter. ${"Incididunt ut labore. ".repeat(100)}

## Section 2.1

Final section. ${"Dolore magna aliqua. ".repeat(100)}
`;

describe("estimateTokens", () => {
  it("estimates tokens from character count", () => {
    const tokens = estimateTokens("hello world");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(8);
  });

  it("returns 1 for very short text", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("splitMarkdown", () => {
  it("does not split small documents", () => {
    const chunks = splitMarkdown("# Title\n\nShort doc.", { maxTokens: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe("Title");
  });

  it("splits on heading boundaries for large docs", () => {
    const chunks = splitMarkdown(largeDoc, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("preserves heading path in chunks", () => {
    const chunks = splitMarkdown(largeDoc, { maxTokens: 500 });
    for (const chunk of chunks) {
      expect(chunk.headingPath).toBeDefined();
    }
  });

  it("each chunk has a title", () => {
    const chunks = splitMarkdown(largeDoc, { maxTokens: 500 });
    for (const chunk of chunks) {
      expect(chunk.title).toBeTruthy();
    }
  });
});
