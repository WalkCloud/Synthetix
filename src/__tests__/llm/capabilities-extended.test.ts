import { describe, it, expect } from "vitest";
import { parseCapabilities, hasCapability } from "@/lib/llm/capabilities";

describe("parseCapabilities", () => {
  it("parses JSON string array", () => {
    expect(parseCapabilities('["chat","embedding"]')).toEqual(["chat", "embedding"]);
  });

  it("returns array as-is if already parsed", () => {
    expect(parseCapabilities(["chat"])).toEqual(["chat"]);
  });

  it("filters non-string values from array", () => {
    expect(parseCapabilities(["chat", 123, null, "embedding"] as unknown)).toEqual(["chat", "embedding"]);
  });

  it("returns empty for non-JSON string", () => {
    expect(parseCapabilities("not-json")).toEqual([]);
  });

  it("returns empty for null/undefined", () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities(undefined)).toEqual([]);
  });

  it("returns empty for JSON object", () => {
    expect(parseCapabilities('{"chat":true}')).toEqual([]);
  });
});

describe("hasCapability", () => {
  it("returns true when capability exists", () => {
    expect(hasCapability('["chat","embedding"]', "chat")).toBe(true);
  });

  it("returns false when capability missing", () => {
    expect(hasCapability('["embedding"]', "chat")).toBe(false);
  });

  it("returns false for null raw", () => {
    expect(hasCapability(null, "chat")).toBe(false);
  });
});
