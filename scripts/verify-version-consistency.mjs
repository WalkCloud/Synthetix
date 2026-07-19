#!/usr/bin/env node
/**
 * Synthetix — version-consistency gate.
 *
 * Asserts that the canonical version (package.json) matches every other place
 * the version is baked in, so a release can never again ship "1.0.3" on the
 * installer while the running app reports "1.0.1" (the v1.0.2 / v1.0.3
 * regression — both bumps forgot to run generate:meta).
 *
 * Checks:
 *   1. package.json.version
 *   2. src/generated/app-version.ts  → appVersion.version
 *   3. dist/electron/win-unpacked/resources/app.asar → package.json.version
 *      (only when the unpacked dir exists, i.e. an Electron build is present)
 *
 * Exit 0 = consistent; exit 1 = drift detected.
 *
 * Usage:  node scripts/verify-version-consistency.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { asarVersionOrNull, isAsarReaderAvailable } from "./lib/asar-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

function log(...m) {
  console.log("\x1b[36m[verify-versions]\x1b[0m", ...m);
}
function err(...m) {
  console.error("\x1b[31m[verify-versions]\x1b[0m", ...m);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parsePlistVersion(xml) {
  const match =
    /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/s.exec(
      xml
    );
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

function readMacBundleVersion(infoPlistPath) {
  const result = spawnSync(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", infoPlistPath],
    { encoding: "utf8", shell: false }
  );
  if (result.status === 0 && result.stdout?.trim()) {
    return result.stdout.trim();
  }
  return parsePlistVersion(fs.readFileSync(infoPlistPath, "utf8"));
}

/** Parse appVersion.version out of the generated TS module without tsc. */
function readGeneratedVersion() {
  const file = path.join(ROOT, "src", "generated", "app-version.ts");
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  // Matches `"version": "1.2.3"` regardless of key ordering / formatting.
  const m = /"version"\s*:\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
}

function main() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const canonical = pkg.version;
  const errors = [];

  log(`canonical version: ${canonical} (package.json)`);

  // 1) src/generated/app-version.ts
  const generated = readGeneratedVersion();
  if (generated === null) {
    errors.push(
      "src/generated/app-version.ts not found — run `npm run generate:meta`."
    );
  } else if (generated !== canonical) {
    errors.push(
      `src/generated/app-version.ts reports ${generated}, expected ${canonical}. ` +
        "Run `npm run generate:meta`."
    );
  } else {
    log(`✓ src/generated/app-version.ts: ${generated}`);
  }

  // 2) app.asar inside an unpacked Electron build, if present.
  const unpackedDir = path.join(ROOT, "dist", "electron", "win-unpacked");
  if (fs.existsSync(path.join(unpackedDir, "Synthetix.exe"))) {
    if (!isAsarReaderAvailable()) {
      // Non-fatal: asar reader is a transitive dep and may be missing in
      // minimal CI checkouts. Warn but don't fail — the asar check is a
      // secondary guard; the primary guard is build-electron.mjs.
      log(
        "⚠ win-unpacked exists but @electron/asar not available — skipping asar check."
      );
    } else {
      const asarVer = asarVersionOrNull(unpackedDir);
      if (asarVer === null) {
        errors.push(
          `win-unpacked exists but app.asar version is unreadable — rebuild with \`npm run electron:build\`.`
        );
      } else if (asarVer !== canonical) {
        errors.push(
          `app.asar reports ${asarVer}, expected ${canonical}. ` +
            "Stale win-unpacked: delete dist/electron/win-unpacked and rebuild."
        );
      } else {
        log(`✓ dist/electron/win-unpacked/resources/app.asar: ${asarVer}`);
      }
    }
  } else {
    log("· dist/electron/win-unpacked absent — skipping asar check.");
  }

  // 3) macOS arm64 app bundle internals, if present.
  const macApp = path.join(
    ROOT,
    "dist",
    "electron",
    "mac-arm64",
    "Synthetix.app"
  );
  if (fs.existsSync(macApp)) {
    const infoPlist = path.join(macApp, "Contents", "Info.plist");
    if (!fs.existsSync(infoPlist)) {
      errors.push(`macOS app exists but Contents/Info.plist is missing: ${macApp}`);
    } else {
      const bundleVersion = readMacBundleVersion(infoPlist);
      if (bundleVersion === null) {
        errors.push(
          "macOS Info.plist does not contain CFBundleShortVersionString. Rebuild the macOS app."
        );
      } else if (bundleVersion !== canonical) {
        errors.push(
          `macOS Info.plist reports ${bundleVersion}, expected ${canonical}. ` +
            "Delete dist/electron/mac-arm64 and rebuild."
        );
      } else {
        log(`✓ dist/electron/mac-arm64/Synthetix.app Info.plist: ${bundleVersion}`);
      }
    }

    const macAsar = path.join(macApp, "Contents", "Resources", "app.asar");
    if (!fs.existsSync(macAsar)) {
      log("· macOS app.asar absent — skipping embedded package version check.");
    } else if (!isAsarReaderAvailable()) {
      log("⚠ macOS app.asar exists but @electron/asar is unavailable — skipping package version check.");
    } else {
      const asarVer = asarVersionOrNull(macAsar);
      if (asarVer === null) {
        errors.push("macOS app.asar exists but its package version is unreadable.");
      } else if (asarVer !== canonical) {
        errors.push(
          `macOS app.asar reports ${asarVer}, expected ${canonical}. ` +
            "Delete dist/electron/mac-arm64 and rebuild."
        );
      } else {
        log(`✓ macOS app.asar package version: ${asarVer}`);
      }
    }
  } else {
    log("· dist/electron/mac-arm64/Synthetix.app absent — skipping macOS internal version checks.");
  }

  if (errors.length > 0) {
    err("✗ version drift detected:");
    for (const e of errors) err("  - " + e);
    process.exit(1);
  }
  log("✓ all version sources consistent.");
}

const IS_MAIN = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

export { parsePlistVersion };

if (IS_MAIN) {
  main();
}
