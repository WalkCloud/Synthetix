import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODULES_TO_REBUILD = [
  { pkg: "better-sqlite3", nodeFile: "better_sqlite3.node" },
];

const BETTER_SQLITE3_SMOKE = `
const Database = require("better-sqlite3");
const db = new Database(":memory:");
try {
  const row = db.prepare("SELECT 42 AS value").get();
  if (row.value !== 42) throw new Error("expected SELECT 42 to return 42");
  process.stdout.write(String(row.value));
} finally {
  db.close();
}
`;

export function smokeNativeModule({ bundledNodePath, appDir }) {
  const result = spawnSync(bundledNodePath, ["-e", BETTER_SQLITE3_SMOKE], {
    cwd: appDir,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || result.stdout?.trim() !== "42") {
    throw new Error(
      `better-sqlite3 SQL smoke failed with bundled Node ${bundledNodePath}: ` +
        `${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`,
    );
  }
  return 42;
}

export function createNodeGypRebuildCommand({
  nodeGypPath,
  targetVersion,
  platform,
  arch,
}) {
  return {
    args: [
      nodeGypPath,
      "rebuild",
      `--target=${targetVersion}`,
      "--runtime=node",
      `--arch=${arch}`,
      `--platform=${platform}`,
    ],
  };
}

function findPackageCopies(appDir, pkgName) {
  const copies = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === pkgName && fs.existsSync(path.join(full, "package.json"))) {
        copies.push(full);
        continue;
      }
      if (entry.name === ".cache") continue;
      visit(full);
    }
  };
  visit(path.join(appDir, "node_modules"));
  visit(path.join(appDir, ".next", "node_modules"));
  return copies;
}

export function rebuildNativeModulesForBundledNode({
  rootDir,
  appDir,
  bundledNodePath,
  platform,
  arch,
  log = () => {},
  warn = () => {},
}) {
  if (!fs.existsSync(bundledNodePath)) {
    throw new Error(`bundled Node not found at ${bundledNodePath}`);
  }
  const versionResult = spawnSync(bundledNodePath, ["--version"], { encoding: "utf8" });
  const targetVersion = versionResult.stdout?.trim();
  if (versionResult.status !== 0 || !targetVersion) {
    throw new Error(`could not read bundled Node version from ${bundledNodePath}`);
  }

  const nodeGypPath = path.join(rootDir, "node_modules", "node-gyp", "bin", "node-gyp.js");
  if (!fs.existsSync(nodeGypPath)) {
    throw new Error(`node-gyp entrypoint not found at ${nodeGypPath}`);
  }

  for (const { pkg, nodeFile } of MODULES_TO_REBUILD) {
    const sourcePackageDir = path.join(rootDir, "node_modules", pkg);
    if (!fs.existsSync(path.join(sourcePackageDir, "binding.gyp"))) {
      throw new Error(`${pkg} binding.gyp not found at ${sourcePackageDir}`);
    }

    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `synthetix-native-${pkg}-`));
    const stagePackageDir = path.join(stageRoot, pkg);
    try {
      fs.cpSync(sourcePackageDir, stagePackageDir, { recursive: true, dereference: true });
      const { args } = createNodeGypRebuildCommand({
        nodeGypPath,
        targetVersion,
        platform,
        arch,
      });
      log(`rebuilding ${pkg} in staging for ${targetVersion} ${platform}-${arch}`);
      const result = spawnSync(bundledNodePath, args, {
        cwd: stagePackageDir,
        stdio: "inherit",
        shell: false,
      });
      if (result.status !== 0) {
        throw new Error(`${pkg} node-gyp rebuild failed with exit ${result.status}`);
      }

      const rebuiltBinary = path.join(stagePackageDir, "build", "Release", nodeFile);
      if (!fs.existsSync(rebuiltBinary)) {
        throw new Error(`rebuilt ${nodeFile} not found at ${rebuiltBinary}`);
      }

      const packageCopies = findPackageCopies(appDir, pkg);
      if (packageCopies.length === 0) {
        throw new Error(`${pkg} was not found in assembled bundle ${appDir}`);
      }
      for (const packageDir of packageCopies) {
        const destination = path.join(packageDir, "build", "Release", nodeFile);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(rebuiltBinary, destination);
      }
      log(`rebuilt ${pkg} for bundled Node ${targetVersion}; updated ${packageCopies.length} bundle copy(ies)`);
    } finally {
      try {
        fs.rmSync(stageRoot, { recursive: true, force: true });
      } catch (error) {
        warn(`could not remove native rebuild staging directory ${stageRoot}: ${error.message}`);
      }
    }
  }

  return targetVersion;
}
