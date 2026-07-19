import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildElectronBuilderEnv,
  resolveBundledPythonPath,
  signingStatusMessage,
} from "../../../scripts/build-electron.mjs";

describe("Windows Authenticode build environment", () => {
  it("maps the decoded certificate and password to electron-builder standard env", () => {
    expect(
      buildElectronBuilderEnv({
        NODE_ENV: "test",
        PATH: "runner-path",
        WINDOWS_CERT_PATH: "C:\\runner\\temp\\synthetix.pfx",
        WINDOWS_CERT_PASSWORD: "super-secret",
      })
    ).toMatchObject({
      PATH: "runner-path",
      CSC_LINK: "C:\\runner\\temp\\synthetix.pfx",
      CSC_KEY_PASSWORD: "super-secret",
    });
  });

  it("leaves unsigned builds free of signing env", () => {
    expect(
      buildElectronBuilderEnv({ NODE_ENV: "test", PATH: "runner-path" })
    ).toEqual({
      NODE_ENV: "test",
      PATH: "runner-path",
    });
  });

  it("reports signing state without including the password", () => {
    const password = "do-not-print-this";
    const message = signingStatusMessage({
      NODE_ENV: "test",
      WINDOWS_CERT_PATH: "C:\\runner\\temp\\synthetix.pfx",
      WINDOWS_CERT_PASSWORD: password,
    });

    expect(message).toMatch(/Authenticode signing enabled/i);
    expect(message).not.toContain(password);
  });

  it("warns when no certificate is configured", () => {
    expect(signingStatusMessage({ NODE_ENV: "test" })).toMatch(/unsigned/i);
  });

  it("accepts python-build-standalone bin layout with a flat fallback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-python-layout-"));
    const binPython = path.join(root, "runtime", "python", "bin", "python.exe");
    const flatPython = path.join(root, "runtime", "python", "python.exe");

    fs.mkdirSync(path.dirname(binPython), { recursive: true });
    fs.writeFileSync(binPython, "");
    expect(resolveBundledPythonPath(root)).toBe(binPython);

    fs.rmSync(binPython);
    fs.writeFileSync(flatPython, "");
    expect(resolveBundledPythonPath(root)).toBe(flatPython);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
