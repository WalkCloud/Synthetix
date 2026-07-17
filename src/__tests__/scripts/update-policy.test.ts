/**
 * Tests for the pure update-trust helpers in electron/update-policy.ts.
 *
 * These helpers are intentionally electron-free (no `app` import) so they can
 * be unit-tested in plain vitest. They are the security-critical decision
 * points for the auto-updater:
 *   - `resolveDownloadAsset`: the downloader trusts ONLY the asset descriptor
 *     pinned at verification time, never a re-fetched manifest.
 *   - `publicStatus`: strips `verifiedAsset` before the IPC boundary.
 *   - `shouldAllowUnsignedManifest`: packaged builds require a signature.
 *   - `isUnsafeEntryName`: Zip-Slip guard for patch extraction.
 *
 * The updater side is imported from the COMPILED electron output
 * (dist/electron-main/update-policy.js) because electron/ is excluded from the
 * root tsconfig. Run `npm run electron:compile` before this test if the
 * compiled JS is stale; CI runs compile-then-test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import nodePath from "node:path";

type PolicyMod = typeof import("../../../dist/electron-main/update-policy.js");
let policy: PolicyMod;

beforeAll(async () => {
  policy = await import("../../../dist/electron-main/update-policy.js");
});

/** Build an `available` status with a pinned verifiedAsset (full path). */
function availableFull(overrides: Partial<{ url: string; sha256: string; size: number; version: string }> = {}) {
  return {
    kind: "available" as const,
    path: "full" as const,
    version: overrides.version ?? "1.2.0",
    releaseName: "Test",
    sizeBytes: overrides.size ?? 629145600,
    releaseNotes: { en: "notes" },
    forced: false,
    verifiedAsset: {
      url: overrides.url ?? "https://example.com/Synthetix-Setup-1.2.0.exe",
      size: overrides.size ?? 629145600,
      sha256: overrides.sha256 ?? "a".repeat(64),
    },
  };
}

describe("resolveDownloadAsset", () => {
  it("returns the pinned url/sha256 for an available update", () => {
    const status = availableFull({ url: "https://a.test/x.exe", sha256: "b".repeat(64), size: 100 });
    const resolved = policy.resolveDownloadAsset(status as never);
    expect(resolved).not.toBeNull();
    expect(resolved!.url).toBe("https://a.test/x.exe");
    expect(resolved!.sha256).toBe("b".repeat(64));
    expect(resolved!.size).toBe(100);
    expect(resolved!.destExt).toBe("exe");
    expect(resolved!.version).toBe("1.2.0");
    expect(resolved!.path).toBe("full");
  });

  it("uses 'zip' extension for the patch path", () => {
    const status = {
      ...availableFull(),
      path: "patch" as const,
      verifiedAsset: { url: "https://a.test/p.zip", size: 50, sha256: "c".repeat(64) },
    };
    const resolved = policy.resolveDownloadAsset(status as never);
    expect(resolved!.destExt).toBe("zip");
    expect(resolved!.path).toBe("patch");
  });

  it("returns null for non-available statuses (so the downloader cannot run)", () => {
    expect(policy.resolveDownloadAsset({ kind: "idle" } as never)).toBeNull();
    expect(policy.resolveDownloadAsset({ kind: "checking" } as never)).toBeNull();
    expect(policy.resolveDownloadAsset({ kind: "ready", path: "full", version: "1.2.0", stagedPath: "x" } as never)).toBeNull();
    expect(policy.resolveDownloadAsset({ kind: "error", message: "boom" } as never)).toBeNull();
  });

  it("reflects ONLY the verified descriptor — swapping url/sha256 after the fact has no effect", () => {
    // This is the core TOCTOU guarantee: even if an attacker replaces a later
    // manifest response, the downloader uses the descriptor pinned here.
    const status = availableFull({ url: "https://legit.test/installer.exe", sha256: "legit".padEnd(64, "0") });
    const resolved = policy.resolveDownloadAsset(status as never);
    expect(resolved!.url).toBe("https://legit.test/installer.exe");
    expect(resolved!.sha256).toBe("legit".padEnd(64, "0"));
  });
});

describe("publicStatus", () => {
  it("strips verifiedAsset from an available status before IPC", () => {
    const status = availableFull();
    const pub = policy.publicStatus(status as never) as Record<string, unknown>;
    expect(pub.verifiedAsset).toBeUndefined();
    // All renderer-visible fields survive.
    expect(pub.kind).toBe("available");
    expect(pub.version).toBe("1.2.0");
    expect(pub.sizeBytes).toBe(629145600);
    expect(pub.path).toBe("full");
    expect(pub.forced).toBe(false);
  });

  it("passes non-available variants through unchanged", () => {
    const idle = { kind: "idle" as const };
    expect(policy.publicStatus(idle as never)).toEqual({ kind: "idle" });
    const err = { kind: "error" as const, message: "boom" };
    expect(policy.publicStatus(err as never)).toEqual({ kind: "error", message: "boom" });
  });
});

describe("shouldAllowUnsignedManifest", () => {
  it("always rejects unsigned manifests when packaged", () => {
    expect(policy.shouldAllowUnsignedManifest(true, undefined)).toBe(false);
    expect(policy.shouldAllowUnsignedManifest(true, "1")).toBe(false);
    expect(policy.shouldAllowUnsignedManifest(true, "0")).toBe(false);
  });

  it("rejects unsigned manifests in unpackaged builds unless explicitly opted in", () => {
    expect(policy.shouldAllowUnsignedManifest(false, undefined)).toBe(false);
    expect(policy.shouldAllowUnsignedManifest(false, "0")).toBe(false);
    expect(policy.shouldAllowUnsignedManifest(false, "")).toBe(false);
  });

  it("allows unsigned manifests only in unpackaged builds with SYNTHETIX_ALLOW_UNSIGNED_UPDATES=1", () => {
    expect(policy.shouldAllowUnsignedManifest(false, "1")).toBe(true);
  });
});

describe("isUnsafeEntryName", () => {
  const dest = nodePath.resolve("C:", "app", "resources", "app");

  it("accepts normal relative entries", () => {
    expect(policy.isUnsafeEntryName(".next/server.js", dest)).toBe(false);
    expect(policy.isUnsafeEntryName("public/logo.png", dest)).toBe(false);
    expect(policy.isUnsafeEntryName("public/sub/deep/file.txt", dest)).toBe(false);
    // Backslash form (crafted Windows zip) that still stays inside.
    expect(policy.isUnsafeEntryName("public\\sub\\file.txt", dest)).toBe(false);
  });

  it("rejects parent-directory traversal", () => {
    expect(policy.isUnsafeEntryName("../escape.txt", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("foo/../../escape.txt", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("foo/bar/../../../escape.txt", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("..\\escape.txt", dest)).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(policy.isUnsafeEntryName("/etc/passwd", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("C:/Windows/system.dll", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("C:\\Windows\\system.dll", dest)).toBe(true);
  });

  it("rejects UNC paths", () => {
    expect(policy.isUnsafeEntryName("//host/share/x.dll", dest)).toBe(true);
    expect(policy.isUnsafeEntryName("\\\\host\\share\\x.dll", dest)).toBe(true);
  });

  it("rejects empty names", () => {
    expect(policy.isUnsafeEntryName("", dest)).toBe(true);
  });
});
