import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const workflowPath = path.resolve(process.cwd(), ".github/workflows/release-windows.yml");

describe("Release (Windows) workflow", () => {
  it("checks out the requested workflow_dispatch tag", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("ref: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref }}");
    expect(workflow).toContain('description: "Release tag to publish (e.g. v1.0.5)"');
  });

  it("loads the shared Node and pnpm pins for CI and the packaged runtime", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("config/runtime-versions.json");
    expect(workflow).toContain("node-version: ${{ env.NODE_VERSION }}");
    expect(workflow).toContain("version: ${{ env.PNPM_VERSION }}");
    expect(workflow).toContain('$nodeVersion = "v$env:NODE_VERSION"');
  });

  it("prepares a complete Windows runtime on a clean runner", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain('$nodeVersion = "v$env:NODE_VERSION"');
    expect(workflow).toContain("$versions.assets.nodeWindowsX64.name");
    expect(workflow).toContain("$nodeArchive = $env:NODE_WINDOWS_X64_ASSET");
    expect(workflow).toContain("$versions.python.standaloneTag");
    expect(workflow).toContain("$versions.python.assets.windowsX64.name");
    expect(workflow).not.toContain(
      "cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz",
    );
    expect(workflow).toContain("workers/python/requirements.txt");
    expect(workflow).toContain("dist/runtime/node.exe");
    expect(workflow).toContain("python/bin/python.exe");
    expect(workflow).toContain("python/python.exe");
    expect(workflow).not.toContain("actions/cache");
  });

  it("fails closed when either downloaded runtime SHA256 does not match", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const prepareIndex = workflow.indexOf("name: Prepare bundled Windows runtime");
    const assembleIndex = workflow.indexOf("name: Assemble app bundle");
    const prepareStep = workflow.slice(prepareIndex, assembleIndex);

    expect(workflow).toContain("$versions.assets.nodeWindowsX64.sha256");
    expect(workflow).toContain("$versions.python.assets.windowsX64.sha256");
    expect(prepareStep).toContain("Get-FileHash");
    expect(prepareStep).toContain("-Algorithm SHA256");
    expect(prepareStep).toMatch(/if \(\$actualNodeSha256 -ne \$env:NODE_WINDOWS_X64_SHA256\) \{\s*throw/);
    expect(prepareStep).toMatch(/if \(\$actualPythonSha256 -ne \$env:PYTHON_WINDOWS_X64_SHA256\) \{\s*throw/);
    expect(prepareStep.indexOf("Get-FileHash $nodeZip")).toBeLessThan(
      prepareStep.indexOf("Expand-Archive $nodeZip"),
    );
    expect(prepareStep.indexOf("Get-FileHash $pythonTar")).toBeLessThan(
      prepareStep.indexOf("tar -xzf $pythonTar"),
    );
  });

  it("smoke-tests every Python worker dependency required by the sidecar", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const prepareIndex = workflow.indexOf("name: Prepare bundled Windows runtime");
    const assembleIndex = workflow.indexOf("name: Assemble app bundle");
    const prepareStep = workflow.slice(prepareIndex, assembleIndex);

    expect(prepareStep).toContain(
      "import torch, docling, lightrag, onnxruntime, transformers",
    );
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

  it("smoke-tests better-sqlite3 with the bundled Node before electron:build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const verifyIndex = workflow.indexOf("name: Verify assembled app bundle");
    const electronBuildIndex = workflow.indexOf("run: pnpm run electron:build");
    const verifyStep = workflow.slice(verifyIndex, electronBuildIndex);

    expect(verifyStep).toContain('dist/app/runtime/node.exe');
    expect(verifyStep).toContain('require("better-sqlite3")');
    expect(verifyStep).toContain(':memory:');
    expect(verifyStep).toContain('SELECT 1 AS value');
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
