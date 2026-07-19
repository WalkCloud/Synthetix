import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronApp = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn(() => "/tmp/synthetix-user-data"),
}));

vi.mock("electron", () => ({ app: electronApp }));

import { pythonPath } from "../../../electron/paths";

const originalResourcesPath = process.resourcesPath;
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-paths-"));
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: path.join(root, "resources"),
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: originalResourcesPath,
  });
});

describe("pythonPath", () => {
  const executable = process.platform === "win32" ? "python.exe" : "python3";

  it("prefers the packaged python-build-standalone bin layout", () => {
    const appRoot = path.join(process.resourcesPath, "app");
    const binned = path.join(appRoot, "runtime", "python", "bin", executable);
    const flat = path.join(appRoot, "runtime", "python", executable);
    fs.mkdirSync(path.dirname(binned), { recursive: true });
    fs.writeFileSync(binned, "binned");
    fs.writeFileSync(flat, "flat");

    expect(pythonPath()).toBe(binned);
  });

  it("falls back to the packaged flat layout when bin is absent", () => {
    const appRoot = path.join(process.resourcesPath, "app");
    const flat = path.join(appRoot, "runtime", "python", executable);
    fs.mkdirSync(path.dirname(flat), { recursive: true });
    fs.writeFileSync(flat, "flat");

    expect(pythonPath()).toBe(flat);
  });
});
