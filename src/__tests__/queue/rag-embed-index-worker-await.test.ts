import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const WORKER_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "queue",
  "workers",
  "rag-embed-index-worker.ts",
);

/**
 * Regression test for the production bug where `resolveProcessingModels(ctx)` was called
 * without `await`, leaving `ctx.embedModel = null` when `embedDocumentChunks(ctx)` ran.
 * Result: every rag_embed_index task silently no-op'd, no chunks got embeddings, and the
 * Token Usage Analytics page stayed empty.
 *
 * `resolveProcessingModels` is `async` (it does `db.modelConfig.findUnique` internally) — any
 * call site must await it. This test reads the source file and asserts the call is awaited.
 */
describe("rag-embed-index-worker source", () => {
  it("awaits resolveProcessingModels — never fires it as an unawaited promise", () => {
    const src = fs.readFileSync(WORKER_PATH, "utf-8");
    // Find every line that calls resolveProcessingModels(...) — the call may be prefixed by
    // optional whitespace and an optional `await ` keyword. Anything else (including a bare
    // call with no `await`) is the regression we're guarding against.
    const callLines = src.split("\n").filter((line) => /\bresolveProcessingModels\s*\(/.test(line));
    expect(callLines.length, "expected at least one call to resolveProcessingModels").toBeGreaterThan(0);
    for (const line of callLines) {
      expect(
        /^\s*await\s+resolveProcessingModels\s*\(/.test(line),
        `resolveProcessingModels must be awaited; found: ${line.trim()}`,
      ).toBe(true);
    }
  });
});
