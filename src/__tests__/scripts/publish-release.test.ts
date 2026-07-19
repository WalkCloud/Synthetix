import { beforeAll, describe, expect, it } from "vitest";

type PublishMod = typeof import("../../../scripts/publish-release.mjs");
let publish: PublishMod;

beforeAll(async () => {
  publish = await import("../../../scripts/publish-release.mjs");
});

describe("GitHub Release creation", () => {
  it("creates a missing release as a draft", () => {
    const args = publish.buildReleaseCreateArgs(
      "v1.0.4",
      "WalkCloud/Synthetix",
      "Synthetix 1.0.4",
      "Release notes"
    );

    expect(args).toEqual([
      "release",
      "create",
      "v1.0.4",
      "--repo",
      "WalkCloud/Synthetix",
      "--title",
      "Synthetix 1.0.4",
      "--notes",
      "Release notes",
      "--draft",
      "--verify-tag",
    ]);
  });
});

describe("existing GitHub Release inspection", () => {
  it("requests only the draft status as a stable scalar", () => {
    expect(
      publish.buildReleaseInspectionArgs("v1.0.4", "WalkCloud/Synthetix")
    ).toEqual([
      "release",
      "view",
      "v1.0.4",
      "--repo",
      "WalkCloud/Synthetix",
      "--json",
      "isDraft",
      "--jq",
      ".isDraft",
    ]);
  });

  it("allows upload only for the exact true output", () => {
    expect(publish.parseExistingReleaseDraftStatus("true\n")).toBe(true);
  });

  it.each(["false", "null", "TRUE", "true false", "", "unexpected"])(
    "rejects non-draft or ambiguous output %j",
    (output) => {
      expect(() => publish.parseExistingReleaseDraftStatus(output)).toThrow(
        /refusing to upload/i
      );
    }
  );

  it("allows creation only when gh explicitly reports that the release was not found", () => {
    expect(
      publish.classifyReleaseInspection({
        status: 1,
        stdout: "",
        stderr: "release not found",
        error: undefined,
      })
    ).toBe("missing");
  });

  it("rejects authentication, network, and execution failures", () => {
    expect(() =>
      publish.classifyReleaseInspection({
        status: 1,
        stdout: "",
        stderr: "HTTP 401: Bad credentials",
        error: undefined,
      })
    ).toThrow(/could not inspect/i);
  });
});
