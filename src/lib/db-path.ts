import fs from "fs";
import os from "os";
import path from "path";

function defaultDataDir(): string {
  return process.env["DB_PATH"] || path.join(os.homedir(), "synthetix-data");
}

export function resolveDataDir(): string {
  const dir = process.env["DATABASE_URL"]
    ? extractFileDir(process.env["DATABASE_URL"])
    : defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveDbPath(): string {
  return path.join(resolveDataDir(), "dev.db");
}

export function resolvePrismaUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const dir = defaultDataDir().replace(/\\/g, "/");
  fs.mkdirSync(dir, { recursive: true });
  return `file:${dir}/dev.db`;
}

function extractFileDir(url: string): string {
  const filePath = url.replace(/^file:/, "").replace(/\\/g, "/");
  return path.dirname(filePath);
}
