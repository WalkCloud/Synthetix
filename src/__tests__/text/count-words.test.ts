import { describe, it, expect } from "vitest";
import { countWords } from "@/lib/text/count-words";

describe("countWords", () => {
  it("counts English words", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("one two three four")).toBe(4);
  });

  it("counts CJK characters", () => {
    expect(countWords("\u4f60\u597d\u4e16\u754c")).toBe(4);
    expect(countWords("\u6d4b\u8bd5")).toBe(2);
  });

  it("counts mixed Latin and CJK", () => {
    expect(countWords("hello\u4f60\u597dworld\u4e16\u754c")).toBe(6);
  });

  it("counts numbers as words", () => {
    expect(countWords("test 123 data")).toBe(3);
  });

  it("handles empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("handles whitespace-only", () => {
    expect(countWords("   ")).toBe(0);
  });
});
