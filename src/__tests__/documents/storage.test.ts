import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalStorageAdapter } from "@/lib/documents/storage";
import fs from "fs";

const TEST_ROOT = "/tmp/synthetix-test-storage";

describe("LocalStorageAdapter", () => {
  const adapter = new LocalStorageAdapter(TEST_ROOT);

  beforeEach(() => {
    if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true });
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true });
  });

  it("saves and reads original file", async () => {
    const file = new File(["test content"], "test.pdf", { type: "application/pdf" });
    const filePath = await adapter.saveOriginal("doc-1", file, "user-1");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain("user-1/doc-1/original.pdf");
  });

  it("saves and reads markdown content", async () => {
    await adapter.saveMarkdown("doc-1", "# Hello\n\nWorld", "user-1");
    const content = await adapter.readMarkdown("doc-1", "user-1");
    expect(content).toBe("# Hello\n\nWorld");
  });

  it("saves chunks with index", async () => {
    await adapter.saveChunk("doc-1", 0, "# Chunk 1", "user-1");
    await adapter.saveChunk("doc-1", 1, "# Chunk 2", "user-1");
    const chunk1 = await adapter.readChunk("doc-1", 0, "user-1");
    const chunk2 = await adapter.readChunk("doc-1", 1, "user-1");
    expect(chunk1).toBe("# Chunk 1");
    expect(chunk2).toBe("# Chunk 2");
  });

  it("deletes all document files", async () => {
    await adapter.saveMarkdown("doc-1", "content", "user-1");
    await adapter.saveChunk("doc-1", 0, "chunk", "user-1");
    await adapter.deleteDocument("doc-1", "user-1");
    const dir = adapter.getDocumentDir("doc-1", "user-1");
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("getDocumentDir returns correct path", () => {
    const dir = adapter.getDocumentDir("doc-123", "user-abc");
    expect(dir).toBe(`${TEST_ROOT}/user-abc/doc-123`);
  });
});
