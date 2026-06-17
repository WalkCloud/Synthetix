import { describe, expect, it } from "vitest";
import { resolveBrainstormPromptPhase } from "@/lib/brainstorm/phase-routing";

describe("brainstorm phase routing", () => {
  it("uses the direction prompt immediately after the user answers the final length question", () => {
    expect(resolveBrainstormPromptPhase("gathering", [
      { role: "user", content: "我要写一份全栈容器云建设规划，面向内部技术团队" },
      { role: "ai", content: "你期望这份文档的大致篇幅是多少？\n\nA. 简版\nB. 标准版\nC. 完整版\nD. 其他" },
      { role: "user", content: "C，完整版，至少 10000 字" },
    ])).toBe("direction");
  });

  it("keeps gathering when length appears before the final length question", () => {
    expect(resolveBrainstormPromptPhase("gathering", [
      { role: "user", content: "我要写一份 10000 字左右的全栈容器云建设规划" },
    ])).toBe("gathering");
  });

  it("does not change non-gathering phases", () => {
    expect(resolveBrainstormPromptPhase("section_refine", [
      { role: "ai", content: "你期望这份文档的大致篇幅是多少？" },
      { role: "user", content: "B" },
    ])).toBe("section_refine");
  });
});
