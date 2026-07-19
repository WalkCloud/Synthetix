import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const require = createRequire(import.meta.url);
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const runtimeVersionsPath = path.join(root, "config/runtime-versions.json");

describe("Node ecosystem version matrix", () => {
  it("provides one pinned runtime version source", () => {
    expect(fs.existsSync(runtimeVersionsPath)).toBe(true);
  });

  it("keeps package metadata and version manager files aligned", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));

    expect(packageJson.version).toBe("1.0.5");
    expect(packageJson.engines.node).toBe(`>=${versions.node} <25`);
    expect(packageJson.packageManager).toBe(`pnpm@${versions.pnpm}`);
    expect(packageJson.dependencies["better-sqlite3"]).toBe(versions.betterSqlite3);
    expect(packageJson.devDependencies.electron).toBe(versions.electron);
    expect(packageJson.devDependencies["@types/node"]).toBe(versions.nodeTypes);
    expect(read(".node-version").trim()).toBe(versions.node);
    expect(read(".nvmrc").trim()).toBe(versions.node);
  });

  it("makes CI and Windows release load Node and pnpm from the version source", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));

    for (const workflowPath of [
      ".github/workflows/ci.yml",
      ".github/workflows/release-windows.yml",
    ]) {
      const workflow = read(workflowPath);
      expect(workflow).toContain("config/runtime-versions.json");
      expect(workflow).toContain("NODE_VERSION");
      expect(workflow).toContain("PNPM_VERSION");
      expect(workflow).toContain("node-version: ${{ env.NODE_VERSION }}");
      expect(workflow).toContain("version: ${{ env.PNPM_VERSION }}");
      expect(workflow).not.toMatch(/node-version:\s*(?:20|22)(?:\.|\s|$)/);
      expect(workflow).not.toContain("version: 11.1.1");
    }

    const windowsWorkflow = read(".github/workflows/release-windows.yml");
    expect(windowsWorkflow).toContain('$nodeVersion = "v$env:NODE_VERSION"');
    expect(windowsWorkflow).not.toContain("v20.20.2");
    expect(versions.node).toBe("24.18.0");
    expect(versions.pnpm).toBe("11.15.0");
  });

  it("makes the macOS sidecar read the pinned Node version", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));
    const script = read("scripts/build-installer-mac.mjs");

    expect(script).toContain('config/runtime-versions.json');
    expect(script).toContain('const NODE_VERSION = `v${runtimeVersions.node}`');
    expect(script).toContain("runtimeVersions.assets.nodeDarwinArm64.sha256");
    expect(script).not.toContain('const NODE_VERSION = "v20.20.2"');
    expect(script).not.toContain("NODE_MODULE_VERSION 115");
    expect(versions.node).toBe("24.18.0");
  });

  it("makes the Windows assembler validate its runtime cache from the shared source", () => {
    const script = read("scripts/build-installer.mjs");

    expect(script).toContain("config/runtime-versions.json");
    expect(script).toContain("createWindowsRuntimeFingerprint");
    expect(script).toContain("validateOrInvalidateRuntimeCache");
    expect(script).toContain(".synthetix-runtime-fingerprint.json");
    const helper = read("scripts/lib/runtime-integrity.mjs");
    expect(helper).toContain("runtimeVersions.assets.nodeWindowsX64");
    expect(helper).toContain("runtimeVersions.python.assets.windowsX64");
    expect(script).not.toContain("v20.20.2");
    expect(script).not.toContain("Python 3.12");
  });

  it("validates macOS cache fingerprints and archive hashes before extraction", () => {
    const script = read("scripts/build-installer-mac.mjs");

    expect(script).toContain("createMacRuntimeFingerprint");
    expect(script).toContain("validateOrInvalidateRuntimeCache");
    expect(script).toContain("JSON.stringify(RUNTIME_FINGERPRINT");
    expect(script).toContain("assertFileSha256(tgz, NODE_SHA256");
    expect(script).toContain("assertFileSha256(tgz, PYTHON_SHA256");
    expect(script.indexOf("assertFileSha256(tgz, NODE_SHA256")).toBeLessThan(
      script.indexOf('run("tar", ["-xzf", tgz'),
    );
  });

  it("pins one Python 3.14 standalone release for both sidecars", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));
    const python = versions.python;

    expect(python.version).toBe("3.14.6");
    expect(python.standaloneTag).toBe("20260718");
    expect(python.assets.macArm64.name).toBe(
      "cpython-3.14.6+20260718-aarch64-apple-darwin-install_only.tar.gz",
    );
    expect(python.assets.windowsX64.name).toBe(
      "cpython-3.14.6+20260718-x86_64-pc-windows-msvc-install_only.tar.gz",
    );

    for (const asset of Object.values(python.assets) as Array<{
      name: string;
      sha256: string;
    }>) {
      expect(asset.name).toContain(`cpython-${python.version}+${python.standaloneTag}`);
      expect(asset.name.endsWith("-install_only.tar.gz")).toBe(true);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("pins a 64-hex SHA256 for every downloaded runtime asset", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));
    const assets = [
      versions.assets.nodeWindowsX64,
      versions.assets.nodeDarwinArm64,
      versions.python.assets.windowsX64,
      versions.python.assets.macArm64,
    ];

    expect(assets).toHaveLength(4);
    for (const asset of assets) {
      expect(asset.name).toBeTruthy();
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("makes macOS and Windows consume their Python assets from the shared source", () => {
    const macScript = read("scripts/build-installer-mac.mjs");
    const windowsWorkflow = read(".github/workflows/release-windows.yml");

    expect(macScript).toContain("runtimeVersions.python.standaloneTag");
    expect(macScript).toContain("runtimeVersions.python.assets.macArm64.name");
    expect(macScript).toContain("runtimeVersions.python.assets.macArm64.sha256");
    expect(macScript).not.toMatch(/cpython-3\.\d+\.\d+\+\d+-aarch64-apple-darwin/);
    expect(windowsWorkflow).toContain("$versions.python.standaloneTag");
    expect(windowsWorkflow).toContain("$versions.python.assets.windowsX64.name");
    expect(windowsWorkflow).toContain("$versions.python.assets.windowsX64.sha256");
    expect(windowsWorkflow).not.toMatch(/cpython-3\.\d+\.\d+\+\d+-x86_64-pc-windows-msvc/);
  });

  it("prevents transformers 5 from breaking the daemon remote-code protocol", () => {
    const requirements = read("workers/python/requirements.txt");

    expect(requirements).toContain("transformers>=4.44.0,<5");
    expect(requirements).toMatch(/daemon.*remote-code protocol/i);
    expect(requirements).not.toMatch(/^transformers>=4\.44\.0\s*$/m);
  });

  it("locks the requested direct dependency versions", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));
    const lock = read("pnpm-lock.yaml");

    expect(lock).toContain(`specifier: ${versions.betterSqlite3}`);
    expect(lock).toContain(`better-sqlite3@${versions.betterSqlite3}:`);
    expect(lock).toContain(`specifier: ${versions.electron}`);
    expect(lock).toContain(`electron@${versions.electron}:`);
    expect(lock).toContain(`specifier: ${versions.nodeTypes}`);
    expect(lock).toContain(`'@types/node@${versions.nodeTypes}'`);
  });

  it("declares Electron 43's macOS 12 minimum in packaging and user docs", () => {
    const builder = read("electron-builder.yml");
    const readme = read("README.md");
    const releaseGuide = read("docs/v1.0.5-release-guide.md");

    expect(builder).toContain("minimumSystemVersion: 12.0");
    expect(readme).toMatch(/macOS 12(?:\.0)?\+/);
    expect(releaseGuide).toMatch(/macOS 12(?:\.0)?\+/);
  });

  it("uses Electron 43.1.1 with embedded Node 24.18.0", () => {
    const versions = JSON.parse(read("config/runtime-versions.json"));
    const electronPackagePath = require.resolve("electron/package.json", {
      paths: [root],
    });
    const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, "utf8"));
    const electronBinary = path.join(
      path.dirname(electronPackagePath),
      "dist/Electron.app/Contents/MacOS/Electron",
    );

    expect(electronPackage.version).toBe(versions.electron);
    expect(fs.existsSync(electronBinary)).toBe(true);
    const embeddedNode = execFileSync(
      electronBinary,
      ["-p", "process.versions.node"],
      { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    ).trim();
    expect(embeddedNode).toBe(versions.node);
  });
});
