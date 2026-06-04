import { describe, expect, it } from "vitest";
import { taskMatchesSession } from "@/lib/brainstorm/task-matching";

describe("taskMatchesSession", () => {
  it("matches exact sessionId", () => {
    expect(taskMatchesSession(JSON.stringify({ sessionId: "session-1" }), "session-1")).toBe(true);
  });

  it("does not match a session id substring from another field", () => {
    const inputData = JSON.stringify({ sessionId: "session-2", note: "session-1" });

    expect(taskMatchesSession(inputData, "session-1")).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(taskMatchesSession("{bad json", "session-1")).toBe(false);
  });

  it("returns false for null input", () => {
    expect(taskMatchesSession(null, "session-1")).toBe(false);
  });
});
