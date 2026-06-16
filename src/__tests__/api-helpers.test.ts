import { describe, it, expect } from "vitest";
import { getErrorMessage } from "@/lib/api-helpers";

describe("getErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(getErrorMessage(new Error("test message"))).toBe("test message");
    expect(getErrorMessage(new TypeError("type oops"))).toBe("type oops");
  });

  it("returns 'Unknown error' for non-Error values", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(123)).toBe("Unknown error");
    expect(getErrorMessage(null)).toBe("Unknown error");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
    expect(getErrorMessage({ message: "fake" })).toBe("Unknown error");
  });
});
