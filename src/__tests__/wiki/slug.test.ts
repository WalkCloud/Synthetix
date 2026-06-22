import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/wiki/slug";

describe("slugify", () => {
  it("lowercases latin titles and replaces separators with hyphens", () => {
    expect(slugify("Microservice Communication Patterns")).toBe("microservice-communication-patterns");
  });

  it("collapses multiple non-alphanumeric chars into a single hyphen", () => {
    expect(slugify("API / Gateway: Setup & Config")).toBe("api-gateway-setup-config");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--- Some Topic ---")).toBe("some-topic");
  });

  it("preserves CJK characters as-is (OKF identity stays human-meaningful)", () => {
    expect(slugify("微服务通信模式")).toBe("微服务通信模式");
  });

  it("handles mixed CJK + latin content", () => {
    expect(slugify("使用 RAG 进行检索")).toBe("使用-rag-进行检索");
  });

  it("handles Japanese kana and kanji", () => {
    expect(slugify("データ処理パイプライン")).toBe("データ処理パイプライン");
  });

  it("returns a fallback for empty/whitespace input", () => {
    expect(slugify("")).toMatch(/^entry-\d+$/);
    expect(slugify("   ")).toMatch(/^entry-\d+$/);
  });

  it("handles numbers", () => {
    expect(slugify("Section 3.2 Architecture")).toBe("section-3-2-architecture");
  });

  it("collapses consecutive hyphens from multiple spaces/punctuation", () => {
    expect(slugify("A   ---   B")).toBe("a-b");
  });
});
