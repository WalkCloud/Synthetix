#!/usr/bin/env node
/**
 * Generate build/icon.icns from public/logo.png using macOS built-in tools.
 *
 * Uses sips (resize) + iconutil (assemble .icns). No npm dependencies.
 * Requires macOS (sips and iconutil are macOS-only). The script enforces this.
 *
 * Usage:  node scripts/generate-icns.mjs
 *
 * Re-run only when public/logo.png changes; commit build/icon.icns.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const SOURCE = path.join(ROOT, "public", "logo.png");
const ICONSET_DIR = path.join(ROOT, "build", "icon.iconset");
const OUT_ICNS = path.join(ROOT, "build", "icon.icns");

function fail(...m) {
  console.error(`\x1b[31m[generate-icns:ERROR]\x1b[0m`, ...m);
  process.exit(1);
}
function log(...m) {
  console.log(`\x1b[36m[generate-icns]\x1b[0m`, ...m);
}
function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

// macOS-only tools.
if (process.platform !== "darwin") {
  fail(`generate-icns requires macOS (sips + iconutil). Current: ${process.platform}`);
}
for (const t of ["sips", "iconutil"]) {
  if (spawnSync("which", [t]).status !== 0) fail(`${t} not found on PATH`);
}

if (!fs.existsSync(SOURCE)) fail(`source not found: ${path.relative(ROOT, SOURCE)}`);

// Apple's iconset spec: <size>x<size>@<scale>.png. The pixel size = size*scale.
const SIZES = [
  [16, 1], [16, 2],
  [32, 1], [32, 2],
  [64, 1], [64, 2],
  [128, 1], [128, 2],
  [256, 1], [256, 2],
  [512, 1], [512, 2],
];

log(`preparing iconset at ${path.relative(ROOT, ICONSET_DIR)}`);
rmrf(ICONSET_DIR);
fs.mkdirSync(ICONSET_DIR, { recursive: true });

for (const [size, scale] of SIZES) {
  const px = size * scale;
  const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
  const out = path.join(ICONSET_DIR, name);
  // sips -z height width forces the exact pixel dimensions.
  const res = spawnSync("sips", ["-z", String(px), String(px), SOURCE, "--out", out], {
    stdio: "inherit",
  });
  if (res.status !== 0) fail(`sips failed for ${name} (exit ${res.status})`);
}

log(`assembling ${path.relative(ROOT, OUT_ICNS)} via iconutil`);
const res = spawnSync("iconutil", ["-c", "icns", ICONSET_DIR, "-o", OUT_ICNS], {
  stdio: "inherit",
});
if (res.status !== 0) fail(`iconutil failed (exit ${res.status})`);

rmrf(ICONSET_DIR);
const kb = (fs.statSync(OUT_ICNS).size / 1024).toFixed(0);
log(`✓ wrote build/icon.icns (${kb} KB)`);
