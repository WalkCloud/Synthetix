import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { convertToMarkdown, convertDocumentFile } from "@/lib/documents/converter";

// Track python invocations across the mocked spawn. Declared via vi.hoisted so
// the mock factory (itself hoisted above imports) can reference it legally.
const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as string[][] }));

// Fake the Docling conversion: record the call, write the artifact files the
// converter's cache validator checks for, return a ConversionResult pointing at
// them. fs/path are loaded lazily inside the async fn (hoisting-safe).
vi.mock("@/lib/python", () => ({
  spawnPythonJson: vi.fn(async (_script: string, args: string[]) => {
    const fsMod = await import("fs");
    const pathMod = await import("path");
    spawnCalls.push(args);
    const outputDir = args[1] as string;
    const mdPath = pathMod.join(outputDir, "full.md");
    const structPath = pathMod.join(outputDir, "structure.json");
    fsMod.writeFileSync(mdPath, "# Cached doc\n\nbody.", "utf-8");
    fsMod.writeFileSync(structPath, "{}", "utf-8");
    return {
      markdown: mdPath,
      structure: structPath,
      imageManifest: null,
      imageCount: 0,
      format: "docling",
      conversionMethod: "docling" as const,
    };
  }),
}));

let tmpDir: string;

describe("convertToMarkdown", () => {
  it("is a function", () => {
    expect(typeof convertToMarkdown).toBe("function");
  });

  it("rejects for nonexistent file", async () => {
    await expect(
      convertToMarkdown("/nonexistent/file-12345.xyz", "/tmp/test-out")
    ).rejects.toThrow("Input file does not exist");
  });
});

describe("convertDocumentFile — markdown conversion cache", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-cache-"));
    spawnCalls.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeInput(): string {
    const p = path.join(tmpDir, "src.docx");
    fs.writeFileSync(p, "x", "utf-8");
    return p;
  }

  it("skips Python on a cache hit (same hash+size) and reuses artifacts", async () => {
    const input = makeInput();
    const key = { originalHash: "abc123", originalSize: 1 };

    const first = await convertDocumentFile(input, tmpDir, key);
    expect(spawnCalls).toHaveLength(1);
    expect(first.conversionMethod).toBe("docling");

    // Second call with the SAME key must hit the cache and NOT spawn again.
    const second = await convertDocumentFile(input, tmpDir, key);
    expect(spawnCalls).toHaveLength(1);
    expect(second.markdown).toBe(first.markdown);
  });

  it("re-converts when the source hash differs", async () => {
    const input = makeInput();

    await convertDocumentFile(input, tmpDir, { originalHash: "hash-aaa", originalSize: 1 });
    expect(spawnCalls).toHaveLength(1);

    await convertDocumentFile(input, tmpDir, { originalHash: "hash-bbb", originalSize: 1 });
    expect(spawnCalls).toHaveLength(2); // different hash → cache miss → re-convert
  });

  it("re-converts when the source size differs", async () => {
    const input = makeInput();
    const hash = "same-hash";

    await convertDocumentFile(input, tmpDir, { originalHash: hash, originalSize: 1 });
    await convertDocumentFile(input, tmpDir, { originalHash: hash, originalSize: 999 });
    expect(spawnCalls).toHaveLength(2);
  });

  it("always converts when no cacheKey is supplied (force reconvert)", async () => {
    const input = makeInput();

    await convertDocumentFile(input, tmpDir);
    await convertDocumentFile(input, tmpDir);
    expect(spawnCalls).toHaveLength(2);
  });
});
