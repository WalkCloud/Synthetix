import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for the RAG soft-fail contract.
 *
 * `fetchRagReferences` used to `throw` on any retrieval error (daemon timeout,
 * slow embedding scan, transient embed-model failure), which propagated to the
 * SSE generate route and marked the whole section `status:"failed"`. The fix
 * degrades to `return []` (matching the fail-soft contract of fetchWikiContext
 * and enrichSectionContext), so a RAG outage no longer blocks generation.
 *
 * This test drives `generateSectionStream` with:
 *   - semanticSearch mocked to REJECT (simulating a RAG outage)
 *   - the LLM provider, enrichment, and wiki all mocked to no-ops
 * and asserts the function resolves without re-throwing the RAG error.
 *
 * Because `fetchRagReferences` is module-private, we exercise it via the public
 * `generateSectionStream` entrypoint — the only caller in production.
 */

// vi.mock factories are hoisted above imports, so any value they reference
// must be created with vi.hoisted (also hoisted) — otherwise it is a
// "Cannot access X before initialization" ReferenceError.
const mocks = vi.hoisted(() => {
  return {
    semanticSearch: vi.fn().mockRejectedValue(new Error("daemon timeout (simulated)")),
    rewriteWikiQuery: vi.fn().mockResolvedValue([]),
    queryWikiForSection: vi.fn().mockResolvedValue([]),
    getLLMClient: vi.fn(),
    recordTokenUsageSafely: vi.fn().mockResolvedValue(undefined),
    fakeProvider: {
      chat: vi.fn().mockResolvedValue({ content: "{}", inputTokens: 1, outputTokens: 1 }),
      chatStream: vi.fn(),
      embed: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
});

// Mock semanticSearch to throw — this is the RAG outage under test.
vi.mock("@/lib/search/semantic", () => ({ semanticSearch: mocks.semanticSearch }));

// Mock the LLM client resolver so we don't need a real provider/model in the DB.
vi.mock("@/lib/llm/client", () => ({
  getLLMClient: mocks.getLLMClient.mockResolvedValue({
    provider: mocks.fakeProvider,
    modelId: "test-model",
    modelConfigId: "test-config",
  }),
}));

// Mock wiki retrieval (both the LLM rewrite and the SQL query) so the only
// thing that can fail in the pipeline is RAG.
vi.mock("@/lib/wiki/query", () => ({
  rewriteWikiQuery: mocks.rewriteWikiQuery,
  queryWikiForSection: mocks.queryWikiForSection,
}));

// Avoid hitting the token-usage DB path.
vi.mock("@/lib/llm/usage", () => ({ recordTokenUsageSafely: mocks.recordTokenUsageSafely }));

import { generateSectionStream } from "@/lib/writing/generator";
import { semanticSearch } from "@/lib/search/semantic";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSectionStream RAG soft-fail", () => {
  it("does not throw when semanticSearch rejects (degrades to empty RAG)", async () => {
    const draft = {
      id: "draft-1",
      title: "Test Draft",
      description: null,
      outline: JSON.stringify({
        title: "Test Draft",
        sections: [{ num: "1", title: "Intro", children: [] }],
      }),
    };
    const section = {
      id: "sec-1",
      title: "Intro",
      description: "intro",
      keyPoints: null,
      estimatedWords: 100,
      constraints: null,
      ragMode: "auto",
      ragDocumentIds: null,
    };

    // RAG is set to "auto" (the default) so fetchRagReferences WILL be invoked.
    // The await itself is the assertion: prior to the soft-fail fix this would
    // throw "Failed to retrieve RAG references..." and reject the promise.
    const result = await generateSectionStream(
      draft as never,
      section as never,
      [] as never,
      "user-1",
    );

    // semanticSearch was called and rejected, but generateSectionStream still
    // resolved (did not re-throw) — this is the soft-fail contract.
    expect(semanticSearch).toHaveBeenCalled();
    expect(result).toBeDefined();
    // RAG degraded to empty; wiki-derived refs (also empty here) still present.
    expect(result.ragReferences).toEqual([]);
    expect(result.wikiEntries).toEqual([]);
  });

  it("returns empty RAG references when ragMode is 'off' (never calls semanticSearch)", async () => {
    const draft = {
      id: "draft-2",
      title: "Test Draft",
      description: null,
      outline: JSON.stringify({ title: "Test Draft", sections: [] }),
    };
    const section = {
      id: "sec-2",
      title: "Intro",
      description: "intro",
      keyPoints: null,
      estimatedWords: 100,
      constraints: null,
      ragMode: "off",
      ragDocumentIds: null,
    };

    const result = await generateSectionStream(
      draft as never,
      section as never,
      [] as never,
      "user-2",
    );

    expect(semanticSearch).not.toHaveBeenCalled();
    expect(result.ragReferences).toEqual([]);
  });
});
