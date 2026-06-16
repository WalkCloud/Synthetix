import { describe, expect, it } from "vitest";
import { buildSearchExcerpt, extractQueryTerms } from "@/lib/search/excerpt";

describe("query-centered search excerpts", () => {
  it("centers Chinese exact phrase matches instead of returning chunk prefix", () => {
    const content = [
      "凭据管理",
      "凭据可以保存敏感信息，例如密码、Token、SSH key。",
      "用户可在项目中使用已创建的凭据绑定 DevOps 工具链。",
      "ACP全栈云平台具备微服务治理能力，微服务治理平台提供日志分析能力。",
      "平台还支持调用链追踪、流量策略和安全策略。",
    ].join("\n\n");

    const excerpt = buildSearchExcerpt(content, "微服务治理", 120);

    expect(excerpt).toContain("微服务治理能力");
    expect(excerpt).not.toMatch(/^凭据管理/);
  });

  it("falls back to the beginning when query terms are absent", () => {
    const content = "第一段内容。第二段内容。第三段内容。";
    const excerpt = buildSearchExcerpt(content, "不存在的词", 12);
    expect(excerpt).toBe("第一段内容。第二段内容。...");
  });

  it("extracts Chinese phrase and paired terms", () => {
    expect(extractQueryTerms("微服务治理")).toEqual(["微服务治理", "微服", "务治"]);
  });

  it("keeps exact phrase visible in semantic excerpts", () => {
    const content = "凭据管理。".repeat(40) + "微服务治理平台提供日志分析能力。" + "制品管理。".repeat(40);
    const excerpt = buildSearchExcerpt(content, "微服务治理", 80);
    expect(excerpt).toContain("微服务治理平台");
  });
});
