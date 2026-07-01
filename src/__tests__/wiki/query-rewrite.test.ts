import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { rewriteWikiQuery } from "@/lib/wiki/query";
import type { LLMProvider, ChatResponse } from "@/lib/llm/types";

/** Build a fake LLMProvider whose chat() returns the given JSON string. */
function fakeProvider(content: string): LLMProvider {
  const response: ChatResponse = { content, inputTokens: 0, outputTokens: 0, model: "test" };
  return {
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn(),
    embed: vi.fn(),
    testConnection: vi.fn(),
    getModels: vi.fn(),
  } as unknown as LLMProvider;
}

/** Build a fake LLMProvider whose chat() rejects (simulates LLM failure). */
function failingProvider(): LLMProvider {
  return {
    chat: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    chatStream: vi.fn(),
    embed: vi.fn(),
    testConnection: vi.fn(),
    getModels: vi.fn(),
  } as unknown as LLMProvider;
}

const SECTION = {
  title: "权限配置",
  description: "如何为不同角色配置访问权限",
  keyPoints: "RBAC、角色继承、最小权限原则",
};

describe("rewriteWikiQuery", () => {
  beforeEach(() => {
    // Ensure the rewrite feature is enabled for these tests regardless of env.
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the LLM-supplied terms on a successful call", async () => {
    const provider = fakeProvider(JSON.stringify({
      terms: ["权限配置", "RBAC", "角色管理", "访问控制", "最小权限"],
    }));
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms).toEqual(["权限配置", "RBAC", "角色管理", "访问控制", "最小权限"]);
    expect(provider.chat).toHaveBeenCalledOnce();
  });

  it("returns an empty array when the LLM call fails (non-blocking)", async () => {
    const provider = failingProvider();
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms).toEqual([]);
  });

  it("returns an empty array when the JSON is malformed", async () => {
    const provider = fakeProvider("not valid json at all");
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms).toEqual([]);
  });

  it("returns an empty array when 'terms' is not an array", async () => {
    const provider = fakeProvider(JSON.stringify({ terms: "not an array" }));
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms).toEqual([]);
  });

  it("filters out non-string and empty entries from the terms array", async () => {
    const provider = fakeProvider(JSON.stringify({
      terms: ["valid", 123, "", "   ", null, "also-valid"],
    }));
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms).toEqual(["valid", "also-valid"]);
  });

  it("caps the number of returned terms", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`);
    const provider = fakeProvider(JSON.stringify({ terms: many }));
    const terms = await rewriteWikiQuery(SECTION, "系统设计文档", provider, "gpt-test");
    expect(terms.length).toBeLessThanOrEqual(12);
  });

  it("passes retrievalQuery into the LLM context when provided", async () => {
    const provider = fakeProvider(JSON.stringify({ terms: ["a"] }));
    await rewriteWikiQuery(SECTION, "Doc", provider, "m", "custom intent");
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[1].content).toContain("custom intent");
  });

  it("skips the LLM call entirely when WIKI_QUERY_REWRITE=off", async () => {
    vi.resetModules();
    const original = process.env.WIKI_QUERY_REWRITE;
    process.env.WIKI_QUERY_REWRITE = "off";
    try {
      // Re-import so the module-level constant picks up the env value.
      const { rewriteWikiQuery: rewriteOff } = await import("@/lib/wiki/query");
      const provider = fakeProvider(JSON.stringify({ terms: ["should-not-appear"] }));
      const terms = await rewriteOff(SECTION, "Doc", provider, "m");
      expect(terms).toEqual([]);
      expect(provider.chat).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.WIKI_QUERY_REWRITE;
      else process.env.WIKI_QUERY_REWRITE = original;
    }
  });
});
