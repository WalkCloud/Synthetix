import { describe, it, expect } from "vitest";
import { docStatusLabels, docStatusColors, draftStatusLabels, draftStatusColors } from "@/lib/text/status-labels";

describe("docStatusLabels", () => {
  it("has labels for all document statuses", () => {
    const statuses = ["uploading", "converting", "splitting", "embedding", "indexing", "ready", "failed"];
    for (const s of statuses) {
      expect(docStatusLabels[s]).toBeDefined();
      expect(typeof docStatusLabels[s]).toBe("string");
    }
  });

  it("returns undefined for unknown status", () => {
    expect(docStatusLabels["unknown"]).toBeUndefined();
  });
});

describe("docStatusColors", () => {
  it("has color classes for all document statuses", () => {
    const statuses = ["uploading", "converting", "splitting", "embedding", "indexing", "ready", "failed"];
    for (const s of statuses) {
      expect(docStatusColors[s]).toBeDefined();
      expect(docStatusColors[s]).toContain("bg-");
    }
  });
});

describe("draftStatusLabels", () => {
  it("has labels for all draft statuses", () => {
    expect(draftStatusLabels.drafting).toBe("In Progress");
    expect(draftStatusLabels.assembling).toBe("Assembling");
    expect(draftStatusLabels.completed).toBe("Completed");
  });
});

describe("draftStatusColors", () => {
  it("has color classes for all draft statuses", () => {
    const statuses = ["drafting", "assembling", "completed"];
    for (const s of statuses) {
      expect(draftStatusColors[s]).toBeDefined();
      expect(draftStatusColors[s]).toContain("bg-");
    }
  });
});
