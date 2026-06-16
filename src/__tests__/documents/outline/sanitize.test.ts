import { describe, it, expect } from "vitest";
import { sanitizeMarkdown } from "@/lib/documents/outline/sanitize";

describe("sanitizeMarkdown", () => {
  it("compresses 3+ consecutive newlines", () => {
    const result = sanitizeMarkdown("a\n\n\n\nb\n\n\nc");
    expect(result).toBe("a\n\nb\n\nc");
  });

  it("strips only empty image placeholders", () => {
    const result = sanitizeMarkdown("text ![fig](img.png) text");
    expect(result).toBe("text [Image: fig] text");
  });

  it("keeps useful short image anchors", () => {
    const result = sanitizeMarkdown("text ![Image 1](images/image1.png) text");
    expect(result).toBe("text [Image: Image 1] text");
  });

  it("strips empty image anchors", () => {
    const result = sanitizeMarkdown("text ![](images/image1.png) text");
    expect(result).toBe("text  text");
  });

  it("preserves tables", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(sanitizeMarkdown(input)).toBe(input);
  });

  it("handles empty input", () => {
    expect(sanitizeMarkdown("")).toBe("");
  });
});
