import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WIKI_ALGORITHM_VERSION,
  WIKI_CHECKPOINT_VERSION,
  clearWikiCheckpoint,
  computeCompletedPrefix,
  computeWikiInputHash,
  readWikiCheckpoint,
  writeWikiCheckpoint,
  type WikiCheckpointFileSystem,
  type WikiCheckpointV2,
} from "@/lib/wiki/checkpoint";
import type { SynthChunk } from "@/lib/wiki/synthesizer";

const units: SynthChunk[] = [
  { id: "a", index: 0, content: "alpha" },
  { id: "b", index: 1, content: "beta" },
];

describe("Wiki checkpoint v2", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "wiki-checkpoint-"));
    filePath = path.join(dir, "checkpoint.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function checkpoint(): WikiCheckpointV2 {
    const completedUnits = [{ id: "a", index: 0, microSummary: "summary a" }];
    return {
      version: WIKI_CHECKPOINT_VERSION,
      algorithmVersion: WIKI_ALGORITHM_VERSION,
      inputHash: computeWikiInputHash("chunk", units),
      completedUnits,
      failedUnitIds: ["b"],
      completedPrefix: computeCompletedPrefix(units, completedUnits),
      updatedAt: new Date().toISOString(),
    };
  }

  it("round-trips a matching v2 checkpoint", async () => {
    const value = checkpoint();
    await writeWikiCheckpoint(filePath, value);
    await expect(readWikiCheckpoint(filePath, value.inputHash, units)).resolves.toEqual(value);
  });

  it("invalidates v1 checkpoints and changed input content", async () => {
    await fs.writeFile(filePath, JSON.stringify({
      lastProcessedChunkIndex: 1,
      microSummaries: ["old"],
      totalChunks: 2,
    }));
    await expect(readWikiCheckpoint(filePath, computeWikiInputHash("chunk", units), units)).resolves.toBeNull();

    await writeWikiCheckpoint(filePath, checkpoint());
    const changed = [{ ...units[0], content: "changed" }, units[1]];
    await expect(readWikiCheckpoint(filePath, computeWikiInputHash("chunk", changed), changed)).resolves.toBeNull();
  });

  it("preserves the prior checkpoint when temp-file sync fails", async () => {
    const original = checkpoint();
    await writeWikiCheckpoint(filePath, original);
    const close = vi.fn(async () => {});
    const fileSystem: WikiCheckpointFileSystem = {
      mkdir: async () => {},
      open: async () => ({
        writeFile: async () => {},
        sync: async () => { throw new Error("sync failed"); },
        close,
      }),
      rename: vi.fn(async () => {}),
      rm: vi.fn(async () => {}),
      unlink: async () => {},
      syncDirectory: async () => {},
    };

    await expect(writeWikiCheckpoint(filePath, { ...original, updatedAt: "new" }, fileSystem))
      .rejects.toThrow("sync failed");
    await expect(readWikiCheckpoint(filePath, original.inputHash, units)).resolves.toEqual(original);
    expect(close).toHaveBeenCalled();
    expect(fileSystem.rename).not.toHaveBeenCalled();
    expect(fileSystem.rm).toHaveBeenCalled();
  });

  it("propagates clear failures other than a missing file", async () => {
    const fileSystem: WikiCheckpointFileSystem = {
      mkdir: async () => {},
      open: async () => { throw new Error("unused"); },
      rename: async () => {},
      rm: async () => {},
      unlink: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
      syncDirectory: async () => {},
    };
    await expect(clearWikiCheckpoint(filePath, fileSystem)).rejects.toThrow("permission denied");
  });

  it("uses input type as part of the hash", () => {
    expect(computeWikiInputHash("chunk", units)).not.toBe(computeWikiInputHash("segment", units));
  });

  it("clears without allowing a delayed write to resurrect the file", async () => {
    await writeWikiCheckpoint(filePath, checkpoint());
    await clearWikiCheckpoint(filePath);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate stable unit IDs", () => {
    expect(() => computeWikiInputHash("chunk", [units[0], { ...units[1], id: "a" }])).toThrow(/duplicate/i);
  });
});
