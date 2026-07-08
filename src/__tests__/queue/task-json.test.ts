/**
 * Tests for task JSON parsing helpers.
 *
 * These tests lock the behaviour of parseTaskInput/parseTaskResult in
 * src/lib/queue/task-json.ts, ensuring malformed persisted JSON degrades
 * gracefully instead of crashing routes or the queue.
 *
 * Design: §4.5 — persisted JSON parser centralisation.
 */
import { describe, it, expect } from "vitest";
import { parseTaskInput, parseTaskResult } from "@/lib/queue/task-json";

describe("parseTaskInput", () => {
  it("returns fallback for null", () => {
    expect(parseTaskInput(null, { docId: "" })).toEqual({ docId: "" });
  });

  it("returns fallback for undefined", () => {
    expect(parseTaskInput(undefined, {})).toEqual({});
  });

  it("returns fallback for empty string", () => {
    expect(parseTaskInput("", { default: true })).toEqual({ default: true });
  });

  it("parses valid JSON", () => {
    expect(parseTaskInput('{"docId":"abc"}', {})).toEqual({ docId: "abc" });
  });

  it("returns fallback for malformed JSON", () => {
    expect(parseTaskInput("{broken", { safe: true })).toEqual({ safe: true });
  });

  it("parses JSON with nested objects", () => {
    const raw = '{"options":{"mode":"graph","forceReconnect":true}}';
    expect(parseTaskInput(raw, {})).toEqual({
      options: { mode: "graph", forceReconnect: true },
    });
  });

  it("parses JSON array as input", () => {
    expect(parseTaskInput('[1,2,3]', [])).toEqual([1, 2, 3]);
  });
});

describe("parseTaskResult", () => {
  it("returns fallback for null", () => {
    expect(parseTaskResult(null, { status: "unknown" })).toEqual({ status: "unknown" });
  });

  it("returns fallback for undefined", () => {
    expect(parseTaskResult(undefined, {})).toEqual({});
  });

  it("parses valid JSON result", () => {
    const raw = '{"status":"completed","chunks":42}';
    expect(parseTaskResult(raw, {})).toEqual({ status: "completed", chunks: 42 });
  });

  it("returns fallback for malformed JSON", () => {
    expect(parseTaskResult("not json", { status: "failed" })).toEqual({ status: "failed" });
  });

  it("parses result with graphEntities field", () => {
    const raw = '{"status":"ok","graphEntities":15,"storage":{}}';
    expect(parseTaskResult(raw, {})).toEqual({
      status: "ok",
      graphEntities: 15,
      storage: {},
    });
  });
});
