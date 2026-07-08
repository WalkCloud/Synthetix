import { describe, it, expect } from "vitest";
import { sseEvent, sseDone, sseError } from "@/lib/writing/sse-events";

describe("sseEvent", () => {
  it("serializes a chunk event with content", () => {
    const result = sseEvent("chunk", { content: "hello" });
    expect(result).toBe('data: {"type":"chunk","content":"hello"}\n\n');
  });

  it("serializes a references event with an array", () => {
    const refs = [{ title: "Doc A", content: "snippet" }];
    const result = sseEvent("references", { references: refs });
    const parsed = JSON.parse(result.slice(6, -2));
    expect(parsed.type).toBe("references");
    expect(parsed.references).toEqual(refs);
  });

  it("serializes a reasoning event", () => {
    const result = sseEvent("reasoning", { content: "thinking..." });
    expect(result).toBe('data: {"type":"reasoning","content":"thinking..."}\n\n');
  });

  it("serializes an assets event with count and pending flag", () => {
    const result = sseEvent("assets", { count: 3, pending: true });
    const parsed = JSON.parse(result.slice(6, -2));
    expect(parsed.type).toBe("assets");
    expect(parsed.count).toBe(3);
    expect(parsed.pending).toBe(true);
  });

  it("always terminates with double newline", () => {
    const result = sseEvent("chunk", { content: "x" });
    expect(result.endsWith("\n\n")).toBe(true);
  });

  it("starts with 'data: ' prefix", () => {
    const result = sseEvent("chunk", { content: "x" });
    expect(result.startsWith("data: ")).toBe(true);
  });

  it("produces valid JSON that can be parsed back", () => {
    const result = sseEvent("chunk", { content: 'with "quotes"' });
    const json = result.slice(6, -2);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("chunk");
    expect(parsed.content).toBe('with "quotes"');
  });
});

describe("sseDone", () => {
  it("produces a done event", () => {
    const result = sseDone();
    expect(result).toBe('data: {"type":"done"}\n\n');
  });

  it("produces parseable JSON", () => {
    const result = sseDone();
    const parsed = JSON.parse(result.slice(6, -2));
    expect(parsed.type).toBe("done");
  });
});

describe("sseError", () => {
  it("produces an error event with message", () => {
    const result = sseError("something went wrong");
    expect(result).toBe('data: {"type":"error","error":"something went wrong"}\n\n');
  });

  it("escapes special characters in the message", () => {
    const result = sseError('quote " and backslash \\');
    const parsed = JSON.parse(result.slice(6, -2));
    expect(parsed.error).toBe('quote " and backslash \\');
    expect(parsed.type).toBe("error");
  });
});
