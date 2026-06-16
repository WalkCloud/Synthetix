import { describe, expect, it } from "vitest";
import {
  buildLengthRequirementQuestion,
  conversationHasLengthRequirement,
  hasExplicitLengthRequirement,
} from "@/lib/brainstorm/length-requirement";

describe("brainstorm length requirement", () => {
  it("detects explicit Chinese length requirements", () => {
    expect(hasExplicitLengthRequirement("标准版，控制在 5000 字左右")).toBe(true);
    expect(hasExplicitLengthRequirement("大概 10 页")).toBe(true);
  });

  it("detects explicit English length requirements", () => {
    expect(hasExplicitLengthRequirement("Use the standard version, around 6,000 words.")).toBe(true);
    expect(hasExplicitLengthRequirement("Keep it to 12 pages.")).toBe(true);
  });

  it("treats A/B/C/D as length confirmation only after a length question", () => {
    expect(conversationHasLengthRequirement([
      { role: "ai", content: "你期望这份文档的大致篇幅是多少？\n\nA. 简版\nB. 标准版" },
      { role: "user", content: "B" },
    ])).toBe(true);

    expect(conversationHasLengthRequirement([
      { role: "ai", content: "平台建设的实施节奏预期是怎样的？\n\nA. 两阶段\nB. 三阶段" },
      { role: "user", content: "B" },
    ])).toBe(false);
  });

  it("builds localized fallback questions with multiline options", () => {
    expect(buildLengthRequirementQuestion("zh-CN")).toContain("A. 简版");
    expect(buildLengthRequirementQuestion("zh-CN")).toContain("D. 其他");
    expect(buildLengthRequirementQuestion("en")).toContain("A. Brief");
    expect(buildLengthRequirementQuestion("en")).toContain("D. Other");
  });
});
