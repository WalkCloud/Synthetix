import { describe, expect, it } from "vitest";
import {
  mergeSecretUpdates,
  maskSecret,
  SECRET_FIELDS,
} from "@/lib/settings/secrets";

describe("settings secret helpers", () => {
  it("lists the settings fields that must be protected", () => {
    expect(SECRET_FIELDS).toEqual(expect.arrayContaining([
      "s3AccessKey",
      "s3SecretKey",
      "minioAccessKey",
      "pgPassword",
      "ragPgUrl",
      "ragPgPassword",
      "ragNeo4jPassword",
      "ragMilvusToken",
      "ragMilvusPassword",
      "ragQdrantApiKey",
    ]));
    expect(SECRET_FIELDS).not.toContain("pgUser");
    expect(SECRET_FIELDS).not.toContain("ragMilvusUser");
  });

  it("returns an empty mask for missing secrets and a last-four mask for configured secrets", () => {
    expect(maskSecret(undefined)).toEqual({ configured: false, masked: "" });
    expect(maskSecret("")).toEqual({ configured: false, masked: "" });
    expect(maskSecret("super-secret-value")).toEqual({ configured: true, masked: "••••alue" });
    expect(maskSecret("abc")).toEqual({ configured: true, masked: "••••abc" });
  });

  it("preserves existing secrets for empty or undefined updates and replaces only non-empty values", () => {
    const current = {
      s3AccessKey: "existing-access",
      s3SecretKey: "existing-secret",
      s3Bucket: "old-bucket",
    };

    expect(mergeSecretUpdates(current, {
      s3AccessKey: "",
      s3SecretKey: undefined,
      s3Bucket: "new-bucket",
    })).toEqual({
      s3AccessKey: "existing-access",
      s3SecretKey: "existing-secret",
      s3Bucket: "new-bucket",
    });

    expect(mergeSecretUpdates(current, { s3AccessKey: "new-access" }).s3AccessKey).toBe("new-access");
  });
});
