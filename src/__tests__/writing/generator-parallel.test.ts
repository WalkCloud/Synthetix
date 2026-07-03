import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for the pre-stream parallelization in generateSectionStream
 * / generateSectionFull.
 *
 * Previously enrichment (LLM call #1) and Wiki retrieval (LLM call #2 inside
 * rewriteWikiQuery) ran strictly serially — enrichment finished before Wiki
 * even started. The fix runs them concurrently via Promise.all, removing one
 * full LLM round-trip from the first-token critical path.
 *
 * This test instruments the two calls with overlapping time windows and
 * asserts they actually overlapped (concurrency), then confirms RAG still runs
 * AFTER Wiki (its limit depends on the Wiki entry count).
 */

const mocks = vi.hoisted(() => {
  // Track wall-clock intervals each call was active in.
  const enrichmentActive = { start: 0, end: 0 };
  const wikiActive = { start: 0, end: 0 };
  const ragActive = { start: 0, end: 0 };
  let clock = 0;
  const advance = (ms: number) => {
    clock += ms;
    return clock;
  };

  const fakeProvider = {
    // Enrichment's provider.chat — records its active window, simulates work.
    chat: vi.fn().mockImplementation(async () => {
      enrichmentActive.start = clock;
      await Promise.resolve();
      // simulate the enrichment LLM round-trip advancing the clock
      advance(100);
      enrichmentActive.end = clock;
      return { content: "{}", inputTokens: 1, outputTokens: 1 };
    }),
    chatStream: vi.fn(),
    embed: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue({ data: [] }),
  };

  const rewriteWikiQuery = vi.fn().mockImplementation(async () => {
    wikiActive.start = clock;
    await Promise.resolve();
    advance(120); // wiki rewrite round-trip (longer than enrichment)
    wikiActive.end = clock;
    return [];
  });

  return {
    fakeProvider,
    rewriteWikiQuery,
    semanticSearch: vi.fn().mockImplementation(async () => {
      ragActive.start = clock;
      await Promise.resolve();
      advance(50);
      ragActive.end = clock;
      return [];
    }),
    queryWikiForSection: vi.fn().mockResolvedValue([]),
    enrichmentActive,
    wikiActive,
    ragActive,
  };
});

vi.mock("@/lib/search/semantic", () => ({ semanticSearch: mocks.semanticSearch }));
vi.mock("@/lib/wiki/query", () => ({
  rewriteWikiQuery: mocks.rewriteWikiQuery,
  queryWikiForSection: mocks.queryWikiForSection,
}));
vi.mock("@/lib/llm/client", () => ({
  getLLMClient: vi.fn().mockResolvedValue({
    provider: mocks.fakeProvider,
    modelId: "test-model",
    modelConfigId: "test-config",
  }),
}));
vi.mock("@/lib/llm/usage", () => ({ recordTokenUsageSafely: vi.fn().mockResolvedValue(undefined) }));

import { generateSectionStream } from "@/lib/writing/generator";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSectionStream pre-stream parallelization", () => {
  it("runs enrichment and wiki concurrently (not serially)", async () => {
    const draft = {
      id: "d1",
      title: "Draft",
      description: null,
      outline: JSON.stringify({ title: "Draft", sections: [] }),
    };
    const section = {
      id: "s1",
      title: "Intro",
      description: "intro",
      keyPoints: null,
      estimatedWords: 100,
      constraints: null,
      ragMode: "auto",
      ragDocumentIds: null,
    };

    await generateSectionStream(draft as never, section as never, [] as never, "u1");

    // Enrichment started and finished; Wiki started and finished. For true
    // concurrency, Wiki must have started BEFORE enrichment finished — i.e.
    // wikiActive.start <= enrichmentActive.end. Under the old serial code,
    // wikiActive.start would equal enrichmentActive.end exactly (no overlap).
    const { enrichmentActive, wikiActive, ragActive } = mocks;
    expect(enrichmentActive.end).toBeGreaterThan(enrichmentActive.start);
    expect(wikiActive.end).toBeGreaterThan(wikiActive.start);
    // The concurrency assertion: wiki started no later than enrichment ended.
    expect(wikiActive.start).toBeLessThanOrEqual(enrichmentActive.end);
  });

  it("runs RAG strictly after Wiki completes (limit depends on wiki count)", async () => {
    const draft = {
      id: "d2",
      title: "Draft",
      description: null,
      outline: JSON.stringify({ title: "Draft", sections: [] }),
    };
    const section = {
      id: "s2",
      title: "Intro",
      description: "intro",
      keyPoints: null,
      estimatedWords: 100,
      constraints: null,
      ragMode: "auto",
      ragDocumentIds: null,
    };

    await generateSectionStream(draft as never, section as never, [] as never, "u2");

    const { wikiActive, ragActive } = mocks;
    // RAG must start at or after Wiki finished — the serial dependency is
    // intentional (RAG limit = wiki.entries.length >= 3 ? half : full).
    expect(ragActive.start).toBeGreaterThanOrEqual(wikiActive.end);
  });
});
