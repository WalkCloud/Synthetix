import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function assertFileSha256(filePath, expectedSha256, label = filePath) {
  if (!SHA256_PATTERN.test(expectedSha256)) {
    throw new Error(`Invalid expected SHA256 for ${label}: ${expectedSha256}`);
  }
  const actualSha256 = sha256File(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA256 mismatch for ${label}: got ${actualSha256}, expected ${expectedSha256}`,
    );
  }
  return actualSha256;
}

export function createRuntimeFingerprint({
  runtimeVersions,
  requirementsPath,
  nodeAsset,
  pythonAsset,
}) {
  return {
    schemaVersion: 1,
    node: {
      version: runtimeVersions.node,
      asset: nodeAsset.name,
      sha256: nodeAsset.sha256,
    },
    python: {
      version: runtimeVersions.python.version,
      standaloneTag: runtimeVersions.python.standaloneTag,
      asset: pythonAsset.name,
      sha256: pythonAsset.sha256,
    },
    requirementsSha256: sha256File(requirementsPath),
  };
}

export function createMacRuntimeFingerprint({ runtimeVersions, requirementsPath }) {
  return createRuntimeFingerprint({
    runtimeVersions,
    requirementsPath,
    nodeAsset: runtimeVersions.assets.nodeDarwinArm64,
    pythonAsset: runtimeVersions.python.assets.macArm64,
  });
}

export function createWindowsRuntimeFingerprint({ runtimeVersions, requirementsPath }) {
  return createRuntimeFingerprint({
    runtimeVersions,
    requirementsPath,
    nodeAsset: runtimeVersions.assets.nodeWindowsX64,
    pythonAsset: runtimeVersions.python.assets.windowsX64,
  });
}

function commandVersion(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

export function validateOrInvalidateRuntimeCache({
  cacheDir,
  nodePath,
  pythonPath,
  markerPath,
  expectedFingerprint,
}) {
  if (!fs.existsSync(cacheDir)) return false;

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    return false;
  }

  const fingerprintMatches =
    JSON.stringify(marker) === JSON.stringify(expectedFingerprint);
  const nodeVersion = fs.existsSync(nodePath)
    ? commandVersion(nodePath, ["-v"])
    : null;
  const pythonVersion = fs.existsSync(pythonPath)
    ? commandVersion(pythonPath, ["--version"])
    : null;
  const versionsMatch =
    nodeVersion === `v${expectedFingerprint.node.version}` &&
    pythonVersion === `Python ${expectedFingerprint.python.version}`;

  if (fingerprintMatches && versionsMatch) return true;

  fs.rmSync(cacheDir, { recursive: true, force: true });
  return false;
}
