import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFileSha256,
  createMacRuntimeFingerprint,
  createWindowsRuntimeFingerprint,
  validateOrInvalidateRuntimeCache,
} from "../../../scripts/lib/runtime-integrity.mjs";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-runtime-integrity-"));
  tempDirs.push(dir);
  return dir;
}

function fakeExecutable(filePath: string, output: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`, "utf8");
  fs.chmodSync(filePath, 0o755);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime archive integrity", () => {
  it("rejects a downloaded file when its SHA256 does not match", () => {
    const filePath = path.join(tempDir(), "runtime.tar.gz");
    fs.writeFileSync(filePath, "tampered runtime", "utf8");

    expect(() => assertFileSha256(filePath, "0".repeat(64), "test runtime")).toThrow(
      /SHA256 mismatch.*test runtime/i,
    );
  });
});

describe("macOS runtime cache validation", () => {
  const versions = {
    node: "24.18.0",
    python: {
      version: "3.14.6",
      standaloneTag: "20260718",
      assets: {
        macArm64: {
          name: "cpython-3.14.6+20260718-aarch64-apple-darwin-install_only.tar.gz",
          sha256: "5a234e405386bf486bab196018c01bc4577a4f0cc9fd5bc50f7a979fe4f5c59d",
        },
      },
    },
    assets: {
      nodeDarwinArm64: {
        name: "node-v24.18.0-darwin-arm64.tar.gz",
        sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
      },
    },
  };

  function expectedFingerprint(dir: string) {
    const requirementsPath = path.join(dir, "requirements.txt");
    fs.writeFileSync(requirementsPath, "onnxruntime==1.0\n", "utf8");
    return createMacRuntimeFingerprint({
      runtimeVersions: versions,
      requirementsPath,
    });
  }

  it("deletes a legacy Node 20/Python 3.12 cache instead of reusing it", () => {
    const root = tempDir();
    const cacheDir = path.join(root, ".runtime-cache-darwin");
    const nodePath = path.join(cacheDir, "node");
    const pythonPath = path.join(cacheDir, "python", "bin", "python3");
    const markerPath = path.join(cacheDir, "python", ".synthetix-deps-installed");
    const fingerprint = expectedFingerprint(root);

    fakeExecutable(nodePath, "v20.20.2");
    fakeExecutable(pythonPath, "Python 3.12.13");
    fs.writeFileSync(markerPath, JSON.stringify(fingerprint), "utf8");

    expect(
      validateOrInvalidateRuntimeCache({
        cacheDir,
        nodePath,
        pythonPath,
        markerPath,
        expectedFingerprint: fingerprint,
      }),
    ).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("reuses a cache only when JSON fingerprint and real versions match", () => {
    const root = tempDir();
    const cacheDir = path.join(root, ".runtime-cache-darwin");
    const nodePath = path.join(cacheDir, "node");
    const pythonPath = path.join(cacheDir, "python", "bin", "python3");
    const markerPath = path.join(cacheDir, "python", ".synthetix-deps-installed");
    const fingerprint = expectedFingerprint(root);

    expect(fingerprint).toMatchObject({
      node: { version: "24.18.0", asset: versions.assets.nodeDarwinArm64.name },
      python: {
        version: "3.14.6",
        standaloneTag: "20260718",
        asset: versions.python.assets.macArm64.name,
      },
    });
    expect(fingerprint.requirementsSha256).toMatch(/^[a-f0-9]{64}$/);

    fakeExecutable(nodePath, "v24.18.0");
    fakeExecutable(pythonPath, "Python 3.14.6");
    fs.writeFileSync(markerPath, JSON.stringify(fingerprint, null, 2), "utf8");

    expect(
      validateOrInvalidateRuntimeCache({
        cacheDir,
        nodePath,
        pythonPath,
        markerPath,
        expectedFingerprint: fingerprint,
      }),
    ).toBe(true);
    expect(fs.existsSync(cacheDir)).toBe(true);
  });
});

describe("Windows runtime cache validation", () => {
  const versions = {
    node: "24.18.0",
    python: {
      version: "3.14.6",
      standaloneTag: "20260718",
      assets: {
        windowsX64: {
          name: "cpython-3.14.6+20260718-x86_64-pc-windows-msvc-install_only.tar.gz",
          sha256: "97c01acd70108234ff042699996f3f4163c791f1d6e35de898475936b86ec3b2",
        },
      },
    },
    assets: {
      nodeWindowsX64: {
        name: "node-v24.18.0-win-x64.zip",
        sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
      },
    },
  };

  function expectedFingerprint(dir: string) {
    const requirementsPath = path.join(dir, "requirements.txt");
    fs.writeFileSync(requirementsPath, "onnxruntime==1.0\n", "utf8");
    return createWindowsRuntimeFingerprint({ runtimeVersions: versions, requirementsPath });
  }

  it("deletes a temporary legacy Node 20/Python 3.12 cache", () => {
    const root = tempDir();
    const cacheDir = path.join(root, ".runtime-cache");
    const nodePath = path.join(cacheDir, "node.exe");
    const pythonPath = path.join(cacheDir, "python", "python.exe");
    const markerPath = path.join(cacheDir, ".synthetix-runtime-fingerprint.json");
    const fingerprint = expectedFingerprint(root);

    fakeExecutable(nodePath, "v20.20.2");
    fakeExecutable(pythonPath, "Python 3.12.13");
    fs.writeFileSync(markerPath, JSON.stringify(fingerprint), "utf8");

    expect(validateOrInvalidateRuntimeCache({
      cacheDir,
      nodePath,
      pythonPath,
      markerPath,
      expectedFingerprint: fingerprint,
    })).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("fingerprints Windows asset metadata and requirements", () => {
    const fingerprint = expectedFingerprint(tempDir());

    expect(fingerprint).toMatchObject({
      node: {
        version: "24.18.0",
        asset: versions.assets.nodeWindowsX64.name,
        sha256: versions.assets.nodeWindowsX64.sha256,
      },
      python: {
        version: "3.14.6",
        standaloneTag: "20260718",
        asset: versions.python.assets.windowsX64.name,
        sha256: versions.python.assets.windowsX64.sha256,
      },
    });
    expect(fingerprint.requirementsSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
