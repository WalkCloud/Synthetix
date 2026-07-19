import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const workflowPath = path.resolve(process.cwd(), ".github/workflows/release-windows.yml");

describe("Release (Windows) workflow", () => {
  it("checks out the requested workflow_dispatch tag", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ref: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref }}");
  });

  it("uses a pnpm-compatible CI Node while packaging the pinned app runtime", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("node-version: 22.13.1");
    expect(workflow).toContain('$nodeVersion = "v20.20.2"');
  });

  it("prepares a complete Windows runtime on a clean runner", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain('$nodeVersion = "v20.20.2"');
    expect(workflow).toContain('$nodeArchive = "node-$nodeVersion-win-x64.zip"');
    expect(workflow).toContain(
      "cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz",
    );
    expect(workflow).toContain("workers/python/requirements.txt");
    expect(workflow).toContain("dist/runtime/node.exe");
    expect(workflow).toContain("python/bin/python.exe");
    expect(workflow).toContain("python/python.exe");
    expect(workflow).not.toContain("actions/cache");
  });

  it("assembles dist/app after Next build and before electron:build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const nextBuildIndex = workflow.indexOf("run: pnpm run build");
    const assembleIndex = workflow.indexOf(
      "run: node scripts/build-installer.mjs --assemble-only --no-build",
    );
    const electronBuildIndex = workflow.indexOf("run: pnpm run electron:build");

    expect(nextBuildIndex).toBeGreaterThan(-1);
    expect(assembleIndex).toBeGreaterThan(-1);
    expect(electronBuildIndex).toBeGreaterThan(-1);
    expect(nextBuildIndex).toBeLessThan(assembleIndex);
    expect(assembleIndex).toBeLessThan(electronBuildIndex);
  });

  it("verifies assembled runtime and worker dependencies before electron:build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const verifyIndex = workflow.indexOf("name: Verify assembled app bundle");
    const electronBuildIndex = workflow.indexOf("run: pnpm run electron:build");
    const verifyStep = workflow.slice(verifyIndex, electronBuildIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeLessThan(electronBuildIndex);
    expect(verifyStep).toContain("dist/app/runtime/node.exe");
    expect(verifyStep).toContain("dist/app/runtime/python/bin/python.exe");
    expect(verifyStep).toContain("dist/app/runtime/python/python.exe");
    expect(verifyStep).toContain("dist/app/workers/python/requirements.txt");
    expect(verifyStep).toContain("dist/app/node_modules/prisma");
  });

  it("decodes the Authenticode certificate before electron:build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const decodeIndex = workflow.indexOf("name: Decode code-signing certificate");
    const buildIndex = workflow.indexOf("run: pnpm run electron:build");

    expect(decodeIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(-1);
    expect(decodeIndex).toBeLessThan(buildIndex);
  });

  it("provides the certificate password only to the build step", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const buildStart = workflow.indexOf("name: Build Electron Windows installer");
    const publishStart = workflow.indexOf("name: Publish release assets");
    const buildStep = workflow.slice(buildStart, publishStart);
    const publishStep = workflow.slice(publishStart);

    expect(buildStep).toContain("WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}");
    expect(publishStep).not.toContain("WINDOWS_CERT_PASSWORD");
    expect(publishStep).not.toContain("--win.certificate");
  });

  it("keeps unsigned builds explicit without printing signing secrets", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("::warning::No Windows code-signing certificate provided");
    expect(workflow).not.toContain("echo $env:WINDOWS_CERT_PASSWORD");
    expect(workflow).not.toContain("echo $env:CSC_KEY_PASSWORD");
  });
});
