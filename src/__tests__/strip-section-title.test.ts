import { describe, expect, it } from "vitest";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";

describe("stripLeadingSectionTitle", () => {
  it("removes a duplicated numbered section title at the beginning", () => {
    const content = "1.2.1资源与交付效能分析\n\n正文第一段。";

    expect(stripLeadingSectionTitle(content, "资源与交付效能分析")).toBe("正文第一段。");
  });

  it("removes a duplicated markdown heading at the beginning", () => {
    const content = "### 1.2.1 资源与交付效能分析\n\n正文第一段。";

    expect(stripLeadingSectionTitle(content, "资源与交付效能分析")).toBe("正文第一段。");
  });

  it("keeps normal content when the first line is not the section title", () => {
    const content = "当前银行IT基础设施正在经历资源瓶颈。";

    expect(stripLeadingSectionTitle(content, "资源与交付效能分析")).toBe(content);
  });
});
