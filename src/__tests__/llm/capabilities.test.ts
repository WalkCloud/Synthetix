import { describe, it, expect } from "vitest";
import { parseCapabilities, hasCapability } from "@/lib/llm/capabilities";

describe("parseCapabilities", () => {
  it("parses a JSON string array", () => {
    expect(parseCapabilities('["chat","embedding"]')).toEqual(["chat", "embedding"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCapabilities("[]")).toEqual([]);
  });

  it("returns empty array for null/undefined", () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities(undefined)).toEqual([]);
    expect(parseCapabilities("")).toEqual([]);
  });

  it("handles already-parsed array", () => {
    expect(parseCapabilities(["chat", "image"])).toEqual(["chat", "image"]);
  });

  it("filters non-string items from array", () => {
    expect(parseCapabilities(["chat", 123, "embedding"])).toEqual(["chat", "embedding"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseCapabilities("{invalid")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseCapabilities('{"key":"value"}')).toEqual([]);
    expect(parseCapabilities("123")).toEqual([]);
  });
});

describe("hasCapability", () => {
  it("returns true when capability present", () => {
    expect(hasCapability('["chat","image"]', "chat")).toBe(true);
  });

  it("returns false when capability absent", () => {
    expect(hasCapability('["chat"]', "image")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(hasCapability(null, "chat")).toBe(false);
  });
});
