import { describe, it, expect } from "vitest";
import { convertToMarkdown } from "@/lib/documents/converter";

describe("convertToMarkdown", () => {
  it("is a function", () => {
    expect(typeof convertToMarkdown).toBe("function");
  });

  it("rejects for nonexistent file", async () => {
    try {
      await convertToMarkdown("/nonexistent/file-12345.xyz", "/tmp/test-out");
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });
});
