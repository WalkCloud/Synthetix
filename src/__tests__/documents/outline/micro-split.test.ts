import { describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn();
const createMany = vi.fn();
const microSplitByLocalSemantic = vi.fn(async () => [
  { index: 0, title: "H1", content: "chunk", tokenCount: 20, headingPath: "H1" },
]);

vi.mock("@/lib/db", () => ({
  db: {
    documentChunk: { deleteMany, createMany },
  },
}));

vi.mock("@/lib/documents/outline/micro-split", () => ({
  microSplitByLocalSemantic,
  makeChunkTitle: (hp: string, content: string) => `${hp} — ${content.slice(0, 40)}`,
  packChunksBySize: (chunks: unknown[]) => chunks,
}));
vi.mock("@/lib/search/fts", () => ({ syncFtsIndexForDocument: vi.fn() }));
vi.mock("@/lib/llm/resolve-model", () => ({ resolveModel: vi.fn() }));

describe("splitAndPersistChunks", () => {
  it("uses the ONNX design threshold for local semantic chunking", async () => {
    const { splitAndPersistChunks } = await import("@/lib/documents/pipeline");
    const storage = { saveChunk: vi.fn(async () => undefined) };

    await splitAndPersistChunks(
      {
        taskId: "task-1",
        docId: "doc-1",
        doc: { userId: "user-1" },
        options: { splitStrategy: "structure-llm" },
        outputDir: "",
        markdownPath: "",
        writingModel: null,
        embedModel: null,
        contextWindow: 4096,
        splitThreshold: 300,
        chunkMaxTokens: 500,
      } as never,
      "# H1\n\n第一句话。第二句话。".repeat(200),
      { shouldSplit: true, tokenCount: 1000, wordCount: 1000 },
      storage as never,
    );

    expect(microSplitByLocalSemantic).toHaveBeenCalledWith(expect.any(Array), 500, 0.55);
  });
});
