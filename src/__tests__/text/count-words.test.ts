import { describe, it, expect } from "vitest";
import { countWords } from "@/lib/text/count-words";

describe("countWords", () => {
  it("counts English words", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("one two three four")).toBe(4);
  });

  it("counts CJK characters", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("测试")).toBe(2);
  });

  it("counts mixed Latin and CJK", () => {
    expect(countWords("hello你好world世界")).toBe(6);
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
