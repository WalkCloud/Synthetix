import { describe, expect, it } from "vitest";
import { detectMarker, stripMarker } from "@/lib/brainstorm/markers";

describe("brainstorm markers", () => {
  it.each([
    "NEEDS_GATHERED",
    "DIRECTION_CONFIRMED",
    "GENERATE_DIRECT",
    "SECTION_BY_SECTION",
    "ALL_SECTIONS_CONFIRMED",
  ] as const)("detects %s", (marker) => {
    expect(detectMarker(`Ready.\n${marker}`)).toBe(marker);
  });

  it("returns null when no marker is present", () => {
    expect(detectMarker("No workflow marker here.")).toBeNull();
  });

  it("strips the detected marker and preserves body text", () => {
    const content = "The outline direction is confirmed.\nDIRECTION_CONFIRMED";

    expect(stripMarker(content, "DIRECTION_CONFIRMED")).toBe("The outline direction is confirmed.");
  });

  it("strips only one marker occurrence", () => {
    const content = "Mention GENERATE_DIRECT in text.\nGENERATE_DIRECT";

    expect(stripMarker(content, "GENERATE_DIRECT")).toBe("Mention  in text.\nGENERATE_DIRECT");
  });

  it("leaves content unchanged when marker is null", () => {
    const content = "The outline direction is confirmed.";

    expect(stripMarker(content, null)).toBe(content);
  });
});
