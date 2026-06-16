import { describe, expect, it } from "vitest";
import { buildSearchExcerpt } from "@/lib/search/excerpt";

describe("buildSearchExcerpt", () => {
  it("keeps complete chunk content by default", () => {
    const content = `start ${"x".repeat(5000)} end`;

    expect(buildSearchExcerpt(content)).toBe(content);
  });
});
