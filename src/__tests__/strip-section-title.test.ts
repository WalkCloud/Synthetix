import { describe, expect, it } from "vitest";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";

describe("stripLeadingSectionTitle", () => {
  it("removes a duplicated numbered section title at the beginning", () => {
    const title = "\u8d44\u6e90\u4e0e\u4ea4\u4ed8\u6548\u80fd\u5206\u6790";
    const content = `1.2.1${title}\n\n\u6b63\u6587\u7b2c\u4e00\u6bb5\u3002`;

    expect(stripLeadingSectionTitle(content, title)).toBe("\u6b63\u6587\u7b2c\u4e00\u6bb5\u3002");
  });

  it("removes a duplicated markdown heading at the beginning", () => {
    const title = "\u8d44\u6e90\u4e0e\u4ea4\u4ed8\u6548\u80fd\u5206\u6790";
    const content = `### 1.2.1 ${title}\n\n\u6b63\u6587\u7b2c\u4e00\u6bb5\u3002`;

    expect(stripLeadingSectionTitle(content, title)).toBe("\u6b63\u6587\u7b2c\u4e00\u6bb5\u3002");
  });

  it("keeps normal content when the first line is not the section title", () => {
    const title = "\u8d44\u6e90\u4e0e\u4ea4\u4ed8\u6548\u80fd\u5206\u6790";
    const content = "\u5f53\u524d\u94f6\u884cIT\u57fa\u7840\u8bbe\u65bd\u6b63\u5728\u7ecf\u5386\u8d44\u6e90\u74f6\u9888\u3002";

    expect(stripLeadingSectionTitle(content, title)).toBe(content);
  });
});
