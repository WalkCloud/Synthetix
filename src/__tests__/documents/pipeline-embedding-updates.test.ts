import { describe, expect, it, vi } from "vitest";
import { persistEmbeddingUpdates } from "@/lib/documents/pipeline";

describe("persistEmbeddingUpdates", () => {
  it("writes one update per chunk in the order received", async () => {
    const update = vi.fn(async () => undefined);
    const db = {
      documentChunk: { update },
    };

    await persistEmbeddingUpdates(
      [
        { chunkId: "chunk-1", embedding: new Uint8Array([1]), embedModel: "embed" },
        { chunkId: "chunk-2", embedding: new Uint8Array([2]), embedModel: "embed" },
        { chunkId: "chunk-3", embedding: new Uint8Array([3]), embedModel: "embed" },
      ],
      { db, batchSize: 2 },
    );

    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "chunk-1" },
      data: { embedding: new Uint8Array([1]), embedModel: "embed" },
    });
    expect(update).toHaveBeenNthCalledWith(3, {
      where: { id: "chunk-3" },
      data: { embedding: new Uint8Array([3]), embedModel: "embed" },
    });
  });

  it("skips chunks deleted out from under us (Prisma P2025) without aborting the rest", async () => {
    const calls: string[] = [];
    const db = {
      documentChunk: {
        update: vi.fn(async ({ where }: { where: { id: string } }) => {
          calls.push(where.id);
          if (where.id === "chunk-2") {
            const err = new Error("Record to update not found") as Error & { code: string };
            err.code = "P2025";
            throw err;
          }
        }),
      },
    };

    await persistEmbeddingUpdates(
      [
        { chunkId: "chunk-1", embedding: new Uint8Array([1]), embedModel: "embed" },
        { chunkId: "chunk-2", embedding: new Uint8Array([2]), embedModel: "embed" },
        { chunkId: "chunk-3", embedding: new Uint8Array([3]), embedModel: "embed" },
      ],
      { db, batchSize: 10 },
    );

    expect(calls).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
  });

  it("propagates non-P2025 errors", async () => {
    const db = {
      documentChunk: {
        update: vi.fn(async () => {
          throw new Error("connection lost");
        }),
      },
    };

    await expect(
      persistEmbeddingUpdates(
        [{ chunkId: "chunk-1", embedding: new Uint8Array([1]), embedModel: "embed" }],
        { db, batchSize: 10 },
      ),
    ).rejects.toThrow("connection lost");
  });
});
