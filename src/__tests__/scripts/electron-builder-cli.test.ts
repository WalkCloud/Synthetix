import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const outputs: string[] = [];

afterEach(() => {
  for (const output of outputs.splice(0)) {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

describe("electron-builder 26 configuration", () => {
  it("passes real CLI validation and creates a macOS arm64 directory target", () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-builder-cli-"));
    outputs.push(output);

    execFileSync(
      path.join(root, "node_modules/.bin/electron-builder"),
      [
        "--dir",
        "--mac",
        "--arm64",
        "--config",
        "electron-builder.yml",
        `--config.directories.output=${output}`,
        "--config.extraResources=[]",
        "--config.mac.icon=null",
      ],
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );

    expect(fs.existsSync(path.join(output, "mac-arm64/Synthetix.app"))).toBe(true);
  }, 120_000);
});
