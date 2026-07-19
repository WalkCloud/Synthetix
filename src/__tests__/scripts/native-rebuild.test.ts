import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("bundled Node native module rebuild", () => {
  it("uses one staging rebuild helper from both Windows and macOS assemblers", () => {
    const helper = read("scripts/lib/native-rebuild.mjs");
    const windows = read("scripts/build-installer.mjs");
    const mac = read("scripts/build-installer-mac.mjs");

    expect(helper).toContain("export function createNodeGypRebuildCommand");
    expect(helper).toContain("export function rebuildNativeModulesForBundledNode");
    expect(helper).toContain("export function smokeNativeModule");
    expect(helper).toContain("fs.mkdtempSync");
    expect(helper).toContain('"--runtime=node"');
    expect(helper).toContain('"better-sqlite3"');
    expect(windows).toContain("rebuildNativeModulesForBundledNode");
    expect(mac).toContain("rebuildNativeModulesForBundledNode");
    expect(windows).toContain("smokeNativeModule");
    expect(mac).toContain("smokeNativeModule");
    expect(windows.indexOf("smokeNativeModule({")).toBeGreaterThan(
      windows.indexOf("rebuildNativeModulesForBundledNode({"),
    );
    expect(mac.indexOf("smokeNativeModule({")).toBeGreaterThan(
      mac.indexOf("rebuildNativeModulesForBundledNode({"),
    );
  });

  it("constructs Windows and macOS node-gyp commands for the bundled runtime", async () => {
    const { createNodeGypRebuildCommand } = await import("../../../scripts/lib/native-rebuild.mjs");

    expect(
      createNodeGypRebuildCommand({
        nodeGypPath: "C:\\repo\\node_modules\\.bin\\node-gyp.cmd",
        targetVersion: "v24.18.0",
        platform: "win32",
        arch: "x64",
      }),
    ).toEqual({
      args: [
        "C:\\repo\\node_modules\\.bin\\node-gyp.cmd",
        "rebuild",
        "--target=v24.18.0",
        "--runtime=node",
        "--arch=x64",
        "--platform=win32",
      ],
    });

    expect(
      createNodeGypRebuildCommand({
        nodeGypPath: "/repo/node_modules/.bin/node-gyp",
        targetVersion: "v24.18.0",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toEqual({
      args: [
        "/repo/node_modules/.bin/node-gyp",
        "rebuild",
        "--target=v24.18.0",
        "--runtime=node",
        "--arch=arm64",
        "--platform=darwin",
      ],
    });
  });

  it("runs a real better-sqlite3 SELECT 42 smoke with the requested Node", async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-native-smoke-"));
    try {
      fs.symlinkSync(path.join(root, "node_modules"), path.join(appDir, "node_modules"));
      const { smokeNativeModule } = await import("../../../scripts/lib/native-rebuild.mjs");
      expect(smokeNativeModule({
        bundledNodePath: process.execPath,
        appDir,
      })).toBe(42);
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });
});
