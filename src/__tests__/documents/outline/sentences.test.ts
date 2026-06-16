import { describe, it, expect } from "vitest";
import { splitSentences } from "@/lib/documents/outline/sentences";

describe("splitSentences", () => {
  it("splits Chinese text at punctuation", () => {
    const result = splitSentences("这是第一句话。这是第二句话！还有第三句话？");
    expect(result).toEqual(["这是第一句话。", "这是第二句话！", "还有第三句话？"]);
  });

  it("splits English text at punctuation", () => {
    const result = splitSentences("First sentence. Second! Third?");
    expect(result).toEqual(["First sentence.", " Second!", " Third?"]);
  });

  it("does not split on abbreviations like e.g.", () => {
    const result = splitSentences("Some text (e.g. example) is here. And another.");
    expect(result.some((s) => s.includes("e.g."))).toBe(true);
  });

  it("preserves code blocks as single span", () => {
    const result = splitSentences("```\ncode line 1\ncode line 2\n```");
    expect(result).toEqual(["```\ncode line 1\ncode line 2\n```"]);
  });

  it("preserves tables as single span", () => {
    const result = splitSentences("| a | b |\n| 1 | 2 |");
    expect(result.length).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});
