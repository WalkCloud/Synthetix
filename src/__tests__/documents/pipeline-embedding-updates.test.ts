import { describe, expect, it, vi } from "vitest";
import { persistEmbeddingUpdates } from "@/lib/documents/pipeline";

describe("persistEmbeddingUpdates", () => {
  it("writes embedding updates in awaited transaction batches", async () => {
    const transactions: unknown[][] = [];
    const db = {
      documentChunk: {
        update: vi.fn((operation) => operation),
      },
      $transaction: vi.fn(async (operations: unknown[]) => {
        transactions.push(operations);
      }),
    };

    await persistEmbeddingUpdates(
      [
        { chunkId: "chunk-1", embedding: new Uint8Array([1]), embedModel: "embed" },
        { chunkId: "chunk-2", embedding: new Uint8Array([2]), embedModel: "embed" },
        { chunkId: "chunk-3", embedding: new Uint8Array([3]), embedModel: "embed" },
      ],
      { db, batchSize: 2 },
    );

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(transactions.map((batch) => batch.length)).toEqual([2, 1]);
    expect(db.documentChunk.update).toHaveBeenCalledWith({
      where: { id: "chunk-1" },
      data: { embedding: new Uint8Array([1]), embedModel: "embed" },
    });
  });
});
