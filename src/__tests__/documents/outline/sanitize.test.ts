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

  it("caps headings with 7+ # to 6 #", () => {
    const result = sanitizeMarkdown("########### 1 目录\n\nBody text.");
    expect(result).toContain("###### 1 目录");
    expect(result).not.toContain("#######");
  });

  it("strips TOC tab+page-number suffixes", () => {
    const input = "1 项目建设背景\t6\n\n1.1 银行业数字化转型\t7";
    const result = sanitizeMarkdown(input);
    expect(result).toBe("1 项目建设背景\n\n1.1 银行业数字化转型");
  });

  it("does not strip tab from markdown headings", () => {
    // Real markdown headings (## prefix) should not be touched — they don't
    // have tab+page suffixes in practice, but the rule must not mangle them.
    const input = "## 1 项目建设背景\n\nBody.";
    expect(sanitizeMarkdown(input)).toBe(input);
  });

  it("removes all-empty markdown tables", () => {
    const input = "Intro.\n\n|    |    |    |\n|----|----|----|\n|    |    |    |\n|    |    |    |\n\nAfter.";
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("|    |");
    expect(result).toContain("Intro.");
    expect(result).toContain("After.");
  });

  it("preserves tables with actual content", () => {
    const input = "| Service | Port |\n|---------|------|\n| A       | 8080 |";
    expect(sanitizeMarkdown(input)).toBe(input);
  });

  it("handles empty input", () => {
    expect(sanitizeMarkdown("")).toBe("");
  });
});
