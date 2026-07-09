/**
 * Smoke tests for the third-party notices generator scanner logic.
 *
 * Exercises scanNpm / scanAssets / generateNotices / toTxt against a synthetic
 * node_modules tree in a temp dir, plus the bundled asset manifest. Does not
 * touch the real node_modules or require Python.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Dynamic import — the script is ESM and reads process.argv, but only runs its
// CLI main() when invoked directly (IS_MAIN guard).
let mod: typeof import("../../../scripts/generate-third-party-notices.mjs");
beforeAll(async () => {
  mod = await import("../../../scripts/generate-third-party-notices.mjs");
});

/** Build a tiny fake project: package.json + node_modules with prod & dev deps. */
function makeFakeProject(): { tmp: string; nm: string; pkgJson: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notices-test-"));
  const nm = path.join(tmp, "node_modules");

  // Root package.json: fake-mit-pkg is production, fake-dev-tool is dev-only.
  const pkgJson = path.join(tmp, "package.json");
  fs.writeFileSync(
    pkgJson,
    JSON.stringify({
      name: "fake-app",
      version: "1.0.0",
      dependencies: { "fake-mit-pkg": "^1.0.0", "fake-unknown-pkg": "^0.0.1" },
      devDependencies: { "fake-dev-tool": "^9.0.0", "fake-dev-types": "^1.0.0" },
    }),
  );

  // Package 1: MIT with a LICENSE file (production).
  fs.mkdirSync(path.join(nm, "fake-mit-pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(nm, "fake-mit-pkg", "package.json"),
    JSON.stringify({ name: "fake-mit-pkg", version: "1.2.3", license: "MIT", homepage: "https://example.com" }),
  );
  fs.writeFileSync(
    path.join(nm, "fake-mit-pkg", "LICENSE"),
    "MIT License\n\nCopyright (c) 2026 Test Author\n",
  );
  // Package 2: unknown license (production).
  fs.mkdirSync(path.join(nm, "fake-unknown-pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(nm, "fake-unknown-pkg", "package.json"),
    JSON.stringify({ name: "fake-unknown-pkg", version: "0.0.1" }),
  );
  // Package 3: dev-only tool (should be excluded).
  fs.mkdirSync(path.join(nm, "fake-dev-tool"), { recursive: true });
  fs.writeFileSync(
    path.join(nm, "fake-dev-tool", "package.json"),
    JSON.stringify({ name: "fake-dev-tool", version: "9.1.0", license: "MIT" }),
  );
  // Package 4: dev-only types (should be excluded).
  fs.mkdirSync(path.join(nm, "fake-dev-types"), { recursive: true });
  fs.writeFileSync(
    path.join(nm, "fake-dev-types", "package.json"),
    JSON.stringify({ name: "fake-dev-types", version: "1.0.0", license: "MIT" }),
  );
  return { tmp, nm, pkgJson };
}

describe("generate-third-party-notices", () => {
  it("scanNpm reads package.json + LICENSE text from node_modules", () => {
    const { nm, pkgJson } = makeFakeProject();
    const entries = mod.scanNpm(nm, pkgJson);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["fake-mit-pkg", "fake-unknown-pkg"]);

    const mit = entries.find((e) => e.name === "fake-mit-pkg")!;
    expect(mit.version).toBe("1.2.3");
    expect(mit.license).toBe("MIT");
    expect(mit.source).toBe("npm");
    expect(mit.licenseText).toContain("MIT License");
    expect(mit.copyright).toContain("Copyright (c) 2026 Test Author");
  });

  it("scanNpm excludes devDependencies (dev tooling never ships)", () => {
    const { nm, pkgJson } = makeFakeProject();
    const entries = mod.scanNpm(nm, pkgJson);
    const names = entries.map((e) => e.name);
    expect(names).not.toContain("fake-dev-tool");
    expect(names).not.toContain("fake-dev-types");
  });

  it("scanNpm returns [] for a missing directory", () => {
    expect(
      mod.scanNpm(path.join(os.tmpdir(), "does-not-exist-xyz"), ""),
    ).toEqual([]);
  });

  it("scanAssets reads the bundled manifest", () => {
    const manifest = path.resolve(__dirname, "..", "..", "..", "legal", "assets-notices.json");
    const entries = mod.scanAssets(manifest);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.source === "asset")).toBe(true);
  });

  it("scanPython resolves the requirements.txt transitive closure (not the whole system)", () => {
    const reqFile = path.resolve(__dirname, "..", "..", "..", "workers", "python", "requirements.txt");
    const entries = mod.scanPython(reqFile);
    // Python may be unavailable in some CI environments — skip gracefully.
    if (entries.length === 0) {
      console.warn("scanPython returned [] (python unavailable in this env) — skipping assertions");
      return;
    }
    // Must include the declared worker deps, NOT unrelated system packages.
    const names = entries.map((e) => e.name.toLowerCase());
    expect(names).toContain("docling");
    expect(names).toContain("lightrag-hku");
    expect(names).toContain("transformers");
    // The transitive closure should be present but must NOT contain packages
    // that are unrelated to the worker (the old site-packages scan pulled these in).
    expect(names).not.toContain("edge-tts");
    expect(names).not.toContain("django");
    // Packages stripped from the distributed bundle must NOT appear in notices.
    // These are dead transitive deps (cloud SDKs, dev tooling) — see
    // python-excluded-packages.mjs.
    expect(names).not.toContain("azure-core");
    expect(names).not.toContain("azure-identity");
    expect(names).not.toContain("markitdown");
    expect(names).not.toContain("faker");
    expect(names).not.toContain("scipy");
    // Every entry must be a real worker dependency, all marked source=python.
    expect(entries.every((e) => e.source === "python")).toBe(true);
  });

  it("toTxt produces a header + per-entry section", () => {
    const { nm, pkgJson } = makeFakeProject();
    const entries = mod.scanNpm(nm, pkgJson);
    const txt = mod.toTxt(entries, "Apache-2.0");
    expect(txt).toContain("THIRD-PARTY-NOTICES");
    expect(txt).toContain("Apache-2.0");
    expect(txt).toContain("fake-mit-pkg@1.2.3");
    expect(txt).toContain("MIT License");
  });

  it("generateNotices merges npm deps and de-duplicates by name", () => {
    const { nm, pkgJson } = makeFakeProject();
    const entries = mod.generateNotices({
      nmRoot: nm,
      rootPkgJson: pkgJson,
      // Point python/asset at nonexistent paths so only the fake npm deps count.
      requirementsPath: path.join(os.tmpdir(), "no-requirements.txt"),
      assetManifest: path.join(os.tmpdir(), "no-assets.json"),
      strict: false,
    });
    // Should include both fake packages, de-duplicated.
    const names = entries.map((e) => e.name);
    expect(names.filter((n) => n === "fake-mit-pkg").length).toBe(1);
    expect(names).toContain("fake-unknown-pkg");
    // Dev deps must be excluded.
    expect(names).not.toContain("fake-dev-tool");
  });
});
