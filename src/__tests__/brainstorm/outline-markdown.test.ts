import { describe, expect, it } from "vitest";
import { parseMarkdownToSections } from "@/lib/brainstorm/outline-markdown";

describe("parseMarkdownToSections", () => {
  it("builds a tree from ## and ### headings", () => {
    const md = [
      "## Chapter One",
      "keyPoints: a；b",
      "### Section 1.1",
      "### Section 1.2",
      "## Chapter Two",
    ].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots).toHaveLength(2);
    expect(roots[0].title).toBe("Chapter One");
    expect(roots[0].keyPoints).toEqual(["a", "b"]);
    expect(roots[0].children).toHaveLength(2);
    expect(roots[0].children![0].title).toBe("Section 1.1");
    expect(roots[1].title).toBe("Chapter Two");
  });

  it("supports adaptive depth (#### and ##### mixed)", () => {
    const md = [
      "## A",
      "### A.1",
      "#### A.1.1",
      "##### A.1.1.1",
      "#### A.1.2",
      "### A.2",
    ].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots).toHaveLength(1);
    const a = roots[0];
    expect(a.children).toHaveLength(2); // A.1, A.2
    const a1 = a.children![0];
    expect(a1.children).toHaveLength(2); // A.1.1, A.1.2
    expect(a1.children![0].children).toHaveLength(1); // A.1.1.1
    expect(a1.children![0].children![0].children).toEqual([]); // leaf
  });

  it("parses keyPoints from keyPoints: line AND markdown list items", () => {
    const md = ["## Chapter", "keyPoints: point 1；point 2", "- bullet point 3", "- bullet point 4"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots[0].keyPoints).toEqual(["point 1", "point 2", "bullet point 3", "bullet point 4"]);
  });

  it("strips leading numbering (1.1 / 第一章)", () => {
    const md = ["## 1.1 多集群管理", "## 第一章 总体规划", "## 1、 资源调度"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots[0].title).toBe("多集群管理");
    expect(roots[1].title).toBe("总体规划");
    expect(roots[2].title).toBe("资源调度");
  });

  it("parses estimatedWords from 字数/words line", () => {
    const md = "## Chapter\n字数: 1,500";
    expect(parseMarkdownToSections(md)[0].estimatedWords).toBe(1500);
    const md2 = "## Chapter\nwords: 2000";
    expect(parseMarkdownToSections(md2)[0].estimatedWords).toBe(2000);
  });

  it("returns empty array when there are no headings", () => {
    expect(parseMarkdownToSections("just prose, no headings here")).toEqual([]);
    expect(parseMarkdownToSections("")).toEqual([]);
  });

  it("ignores prose lines between headings", () => {
    const md = ["## Chapter", "Some intro prose that should be ignored.", "### Section"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots[0].title).toBe("Chapter");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children![0].title).toBe("Section");
  });

  it("keeps sibling chapters at the same depth (no accidental nesting)", () => {
    const md = ["## C1", "### C1.1", "## C2", "### C2.1", "### C2.2"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots).toHaveLength(2);
    expect(roots[0].children).toHaveLength(1); // C1.1
    expect(roots[1].children).toHaveLength(2); // C2.1, C2.2 — NOT nested under C1
  });

  it("ignores H1 (#) headings — only ## and deeper are structural", () => {
    const md = ["# Part title (should be ignored)", "## Chapter"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe("Chapter");
  });

  it("skips empty headings gracefully", () => {
    const md = ["## ", "## Real Chapter"].join("\n");
    const roots = parseMarkdownToSections(md);
    expect(roots).toHaveLength(1);
    expect(roots[0].title).toBe("Real Chapter");
  });
});
