/**
 * Tests for the Ed25519 manifest signing used by Plan A supply-chain protection.
 *
 * The signing logic lives in TWO places that must agree:
 *   - scripts/publish-release.mjs   → buildCanonicalString() + crypto.sign
 *   - electron/manifest-signing.ts  → buildCanonicalString() + verifyManifest
 *
 * This suite verifies the END-TO-END chain: a manifest signed by the publish
 * script's algorithm must be accepted by the updater's verifyManifest(). It also
 * confirms tamper detection — mutating any security-critical field invalidates
 * the signature, so a replaced manifest cannot ship code.
 *
 * The updater side is imported from the COMPILED electron output
 * (dist/electron-main/manifest-signing.js) because electron/ is excluded from
 * the root tsconfig. Run `npm run electron:compile` (tsc) before this test if
 * the compiled JS is stale; CI runs compile-then-test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

// Publish-side: buildCanonicalString + sign are in the ESM publish script.
type PublishMod = typeof import("../../../scripts/publish-release.mjs");
let publish: PublishMod;
beforeAll(async () => {
  publish = await import("../../../scripts/publish-release.mjs");
});

// Updater-side: verifyManifest + buildCanonicalString from the compiled TS.
// Using a relative path to dist so this works regardless of test runner cwd.
type VerifyMod = typeof import("../../../dist/electron-main/manifest-signing.js");
let verifyMod: VerifyMod;
beforeAll(async () => {
  verifyMod = await import("../../../dist/electron-main/manifest-signing.js");
});

/** A representative manifest with both full + patch blocks, matching the schema. */
function sampleManifest() {
  return {
    version: "1.2.0",
    channel: "stable",
    publishedAt: "2026-07-08T00:00:00Z",
    forceFull: false,
    platforms: {
      "win-x64": {
        updateKind: "patch",
        full: {
          url: "https://example.com/Synthetix-Setup-1.2.0.exe",
          size: 629145600,
          sha256: "a".repeat(64),
        },
        patch: {
          availableFrom: ["1.1.0", "1.1.1"],
          url: "https://example.com/content-1.2.0-win.zip",
          size: 33554432,
          sha256: "b".repeat(64),
          includesMigrations: true,
          minRuntimeHash: "c".repeat(64),
        },
      },
    },
  };
}

/** Sign a manifest with a freshly generated Ed25519 keypair (publish-side flow). */
function signWithFreshKey(manifest: object) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  // Mirror publish-release.mjs::signManifest exactly.
  const canonical = publish.buildCanonicalString(manifest);
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const pubkeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { signature: sig.toString("hex"), pubkeyHex, privateKeyPem, canonical };
}

/** Attach a signature to a manifest (deep clone first to avoid mutation). */
function withSignature(manifest: object, signature: string) {
  return { ...JSON.parse(JSON.stringify(manifest)), signature };
}

describe("manifest signing — canonical string", () => {
  it("publish-side and updater-side buildCanonicalString agree", () => {
    const m = sampleManifest();
    // The updater-side buildCanonicalString is exported from the compiled module.
    const a = publish.buildCanonicalString(m);
    const b = verifyMod.buildCanonicalString(m);
    expect(a).toBe(b);
  });

  it("is deterministic regardless of how the platforms object is constructed", () => {
    // Two manifests with identical content but built via different object
    // construction (spread vs literal) must yield the same canonical string.
    const m1 = sampleManifest();
    const m2 = { ...m1, platforms: { ...m1.platforms } };
    expect(publish.buildCanonicalString(m1)).toBe(publish.buildCanonicalString(m2));
  });
});

describe("manifest signing — sign + verify round-trip", () => {
  it("accepts a manifest signed by the publish-side algorithm", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const signed = withSignature(m, signature);
    const result = verifyMod.verifyManifest(JSON.stringify(signed), pubkeyHex);
    expect(result.ok).toBe(true);
    expect(result.unsigned).toBeUndefined();
    expect(result.manifest?.version).toBe("1.2.0");
  });

  it("accepts an unsigned manifest in transition mode (no signature field)", () => {
    const m = sampleManifest();
    const { pubkeyHex } = signWithFreshKey(m);
    // No signature attached.
    const result = verifyMod.verifyManifest(JSON.stringify(m), pubkeyHex);
    expect(result.ok).toBe(true);
    expect(result.unsigned).toBe(true);
  });
});

describe("manifest signing — tamper detection", () => {
  it("rejects a modified version number", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const tampered = withSignature(m, signature);
    tampered.version = "99.0.0"; // bumped after signing
    const result = verifyMod.verifyManifest(JSON.stringify(tampered), pubkeyHex);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  it("rejects a modified asset sha256", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const tampered = withSignature(m, signature);
    tampered.platforms["win-x64"].full.sha256 = "0".repeat(64);
    const result = verifyMod.verifyManifest(JSON.stringify(tampered), pubkeyHex);
    expect(result.ok).toBe(false);
  });

  it("rejects a modified asset url (swap to attacker host)", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const tampered = withSignature(m, signature);
    tampered.platforms["win-x64"].full.url = "https://evil.example/payload.exe";
    const result = verifyMod.verifyManifest(JSON.stringify(tampered), pubkeyHex);
    expect(result.ok).toBe(false);
  });

  it("rejects a modified asset size", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const tampered = withSignature(m, signature);
    tampered.platforms["win-x64"].full.size = 1;
    const result = verifyMod.verifyManifest(JSON.stringify(tampered), pubkeyHex);
    expect(result.ok).toBe(false);
  });

  it("rejects a modified patch minRuntimeHash", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const tampered = withSignature(m, signature);
    tampered.platforms["win-x64"].patch.minRuntimeHash = "f".repeat(64);
    const result = verifyMod.verifyManifest(JSON.stringify(tampered), pubkeyHex);
    expect(result.ok).toBe(false);
  });

  it("rejects a signature verified against the WRONG public key", () => {
    const m = sampleManifest();
    const { signature } = signWithFreshKey(m);
    // Generate a second, unrelated keypair.
    const { publicKey: otherPub } = crypto.generateKeyPairSync("ed25519");
    const wrongPubkeyHex = otherPub
      .export({ type: "spki", format: "der" })
      .toString("hex");
    const signed = withSignature(m, signature);
    const result = verifyMod.verifyManifest(JSON.stringify(signed), wrongPubkeyHex);
    expect(result.ok).toBe(false);
  });

  it("allows non-security fields (releaseNotes, timestamps) to change", () => {
    const m = sampleManifest();
    const { signature, pubkeyHex } = signWithFreshKey(m);
    const modified = withSignature(m, signature);
    // These fields are NOT in the signed canonical subset, so editing them is OK.
    (modified as any).releaseNotes = { en: "totally new notes" };
    (modified as any).publishedAt = "1999-01-01T00:00:00Z";
    const result = verifyMod.verifyManifest(JSON.stringify(modified), pubkeyHex);
    expect(result.ok).toBe(true);
  });
});

describe("manifest signing — malformed input", () => {
  it("rejects invalid JSON", () => {
    const { pubkeyHex } = signWithFreshKey(sampleManifest());
    const result = verifyMod.verifyManifest("not json at all", pubkeyHex);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/);
  });

  it("rejects a manifest missing required fields", () => {
    const { pubkeyHex } = signWithFreshKey(sampleManifest());
    const result = verifyMod.verifyManifest(JSON.stringify({ foo: "bar" }), pubkeyHex);
    expect(result.ok).toBe(false);
  });
});
