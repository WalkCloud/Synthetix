/**
 * Tests for the runtime-layer hash used by the patch-update safety guard.
 *
 * The hash function is implemented twice and the two copies MUST agree:
 *   - scripts/publish-release.mjs  → computeRuntimeHash() (populates the manifest)
 *   - electron/runtime-hash.ts     → computeRuntimeHash() (client verifies)
 *
 * This suite exercises the publish-side copy (importable as ESM) for
 * determinism and path-independence — the properties the client relies on.
 * Cross-implementation drift is caught by the structural review note below; a
 * runtime equivalence test would require compiling electron/ which the root
 * tsconfig excludes, so we keep the two implementations minimal and review
 * them together.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeRuntimeHash as computeElectronRuntimeHash } from "../../../electron/runtime-hash";

// The publish script is ESM and exports computeRuntimeHash at module scope.
// We import it dynamically to match the existing script-test pattern.
type HashMod = typeof import("../../../scripts/publish-release.mjs");
let hashMod: HashMod;
beforeAll(async () => {
  // publish-release.mjs calls main() at load only when run as the main module;
  // under vitest it is imported, so main() does not run. We grab the export.
  // If the script is refactored to not export, this will fail loudly — which is
  // the desired signal (the export is part of the test contract).
  hashMod = await import("../../../scripts/publish-release.mjs");
});

/**
 * Build a minimal synthetic app root with the files computeRuntimeHash reads:
 *   runtime/node(.exe), runtime/python/python(.exe), native .node modules
 *   under node_modules, and .py files under workers/python.
 */
function makeFakeAppRoot(
  layout: "macOS" | "windows-like" = process.platform === "win32" ? "windows-like" : "macOS",
): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rt-hash-test-"));
  const isWin = layout === "windows-like";
  fs.mkdirSync(path.join(tmp, "runtime", "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "runtime", isWin ? "node.exe" : "node"), "NODE-BYTES");
  fs.writeFileSync(
    path.join(tmp, "runtime", "python", "bin", isWin ? "python.exe" : "python3"),
    "PY-BYTES"
  );
  fs.mkdirSync(path.join(tmp, "node_modules", "better-sqlite3", "build", "Release"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmp, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    "NATIVE-BYTES"
  );
  fs.mkdirSync(path.join(tmp, "workers", "python"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "workers", "python", "daemon.py"), "# daemon");
  fs.writeFileSync(path.join(tmp, "workers", "python", "rag_index.py"), "# rag");
  return tmp;
}

describe("computeRuntimeHash implementation equivalence", () => {
  for (const layout of ["macOS", "windows-like"] as const) {
    it(`matches the Electron implementation on a synthetic ${layout} layout`, () => {
      const root = makeFakeAppRoot(layout);
      const platform = layout === "windows-like" ? "win32" : "darwin";
      const pythonName = layout === "windows-like" ? "python.exe" : "python3";
      const python = path.join(root, "runtime", "python", "bin", pythonName);
      try {
        const publishBefore = hashMod.computeRuntimeHash(root, platform);
        const electronBefore = computeElectronRuntimeHash(root, platform);
        expect(publishBefore).toBe(electronBefore);

        fs.writeFileSync(python, "PY-CHANGED");
        const publishAfter = hashMod.computeRuntimeHash(root, platform);
        const electronAfter = computeElectronRuntimeHash(root, platform);
        expect(publishAfter).toBe(electronAfter);
        expect(publishAfter).not.toBe(publishBefore);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("computeRuntimeHash (publish-side)", () => {
  it("is deterministic for identical content", () => {
    const rootA = makeFakeAppRoot();
    const rootB = makeFakeAppRoot();
    try {
      const a = hashMod.computeRuntimeHash(rootA);
      const b = hashMod.computeRuntimeHash(rootB);
      expect(a).toBe(b);
      expect(a).toHaveLength(64); // sha256 hex
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("changes when a runtime file changes", () => {
    const root = makeFakeAppRoot();
    try {
      const before = hashMod.computeRuntimeHash(root);
      fs.writeFileSync(path.join(root, "workers", "python", "daemon.py"), "# changed daemon");
      const after = hashMod.computeRuntimeHash(root);
      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("changes when a native .node module changes", () => {
    const root = makeFakeAppRoot();
    try {
      const before = hashMod.computeRuntimeHash(root);
      // Append to the native binary — simulates a rebuild with a new ABI.
      fs.appendFileSync(
        path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
        "EXTRA"
      );
      const after = hashMod.computeRuntimeHash(root);
      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("is independent of the absolute path (only content + relative paths hashed)", () => {
    // Two roots with identical content but different absolute paths must hash
    // the same. This is what lets a publisher on one machine produce a hash the
    // client on another machine accepts — the client's resources/app lives at a
    // totally different absolute path.
    const rootA = makeFakeAppRoot();
    const rootB = makeFakeAppRoot();
    try {
      expect(hashMod.computeRuntimeHash(rootA)).toBe(hashMod.computeRuntimeHash(rootB));
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("ignores the JS layer (.next, public) — only runtime files are hashed", () => {
    const root = makeFakeAppRoot();
    try {
      const before = hashMod.computeRuntimeHash(root);
      // Add JS-layer files that a content zip WOULD change — the hash must not
      // budge, because that's exactly the invariant that makes patching safe.
      fs.mkdirSync(path.join(root, ".next"), { recursive: true });
      fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "changed-build-id");
      fs.mkdirSync(path.join(root, "public"), { recursive: true });
      fs.writeFileSync(path.join(root, "public", "build-info.json"), "{}");
      const after = hashMod.computeRuntimeHash(root);
      expect(after).toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hashes the python-build-standalone bin/ layout (the real bundle shape)", () => {
    // python-build-standalone ships python/bin/python3 + python/lib/...; the
    // build scripts copy that tree verbatim under runtime/python/, so the real
    // interpreter lives at runtime/python/bin/python3 (NOT flat). The hash must
    // find it there and reflect content changes — otherwise the patch-update
    // safety guard silently ignored the python binary, defeating its purpose.
    const isWin = process.platform === "win32";
    const pyName = isWin ? "python.exe" : "python3";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-hash-bin-"));
    try {
      fs.mkdirSync(path.join(root, "runtime", "python", "bin"), { recursive: true });
      fs.mkdirSync(path.join(root, "node_modules", "x", "build", "Release"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "node_modules", "x", "build", "Release", "x.node"),
        "N"
      );
      fs.mkdirSync(path.join(root, "workers", "python"), { recursive: true });
      fs.writeFileSync(path.join(root, "workers", "python", "daemon.py"), "# d");
      fs.writeFileSync(path.join(root, "runtime", isWin ? "node.exe" : "node"), "NODE");
      const binPy = path.join(root, "runtime", "python", "bin", pyName);
      fs.writeFileSync(binPy, "PY-V1");

      const before = hashMod.computeRuntimeHash(root);
      // Change the bin/-located interpreter — hash MUST change.
      fs.writeFileSync(binPy, "PY-V2");
      const after = hashMod.computeRuntimeHash(root);
      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
