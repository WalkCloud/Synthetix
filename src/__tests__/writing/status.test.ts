import { describe, it, expect } from "vitest";
import {
  isSectionDone,
  deriveDraftStatus,
  CONFIRMED_SECTION_STATUSES,
  type SectionStatus,
} from "@/types/writing";

describe("isSectionDone", () => {
  it("returns true for locked", () => {
    expect(isSectionDone("locked")).toBe(true);
  });

  it("returns true for summarized", () => {
    expect(isSectionDone("summarized")).toBe(true);
  });

  const notDoneStatuses: SectionStatus[] = [
    "pending",
    "retrieving",
    "generating",
    "comparing",
    "reviewing",
    "failed",
  ];

  notDoneStatuses.forEach((status) => {
    it(`returns false for ${status}`, () => {
      expect(isSectionDone(status)).toBe(false);
    });
  });
});

describe("deriveDraftStatus", () => {
  it("returns completed when all sections are locked", () => {
    const sections = [
      { status: "locked" },
      { status: "locked" },
      { status: "locked" },
    ];
    expect(deriveDraftStatus(sections)).toBe("completed");
  });

  it("returns completed when all sections are summarized", () => {
    const sections = [
      { status: "summarized" },
      { status: "summarized" },
    ];
    expect(deriveDraftStatus(sections)).toBe("completed");
  });

  it("returns completed with mixed locked and summarized", () => {
    const sections = [
      { status: "locked" },
      { status: "summarized" },
    ];
    expect(deriveDraftStatus(sections)).toBe("completed");
  });

  it("returns drafting when some sections are pending", () => {
    const sections = [
      { status: "locked" },
      { status: "pending" },
      { status: "locked" },
    ];
    expect(deriveDraftStatus(sections)).toBe("drafting");
  });

  it("returns drafting when some sections are reviewing", () => {
    const sections = [
      { status: "locked" },
      { status: "reviewing" },
    ];
    expect(deriveDraftStatus(sections)).toBe("drafting");
  });

  it("returns drafting for empty sections", () => {
    expect(deriveDraftStatus([])).toBe("drafting");
  });

  it("returns drafting when all sections are pending", () => {
    const sections = [
      { status: "pending" },
      { status: "pending" },
    ];
    expect(deriveDraftStatus(sections)).toBe("drafting");
  });

  it("returns drafting when some sections failed", () => {
    const sections = [
      { status: "locked" },
      { status: "failed" },
    ];
    expect(deriveDraftStatus(sections)).toBe("drafting");
  });
});

describe("CONFIRMED_SECTION_STATUSES", () => {
  it("contains locked and summarized", () => {
    expect(CONFIRMED_SECTION_STATUSES).toContain("locked");
    expect(CONFIRMED_SECTION_STATUSES).toContain("summarized");
  });

  it("has exactly 2 entries", () => {
    expect(CONFIRMED_SECTION_STATUSES).toHaveLength(2);
  });

  it("does not contain removed statuses", () => {
    expect(CONFIRMED_SECTION_STATUSES).not.toContain("accepted");
    expect(CONFIRMED_SECTION_STATUSES).not.toContain("assembling");
  });
});
