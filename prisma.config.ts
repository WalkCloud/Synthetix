import "dotenv/config";
import { defineConfig } from "prisma/config";
import fs from "fs";
import os from "os";
import path from "path";

function resolveDbUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const root = process.env["DB_PATH"] || path.join(os.homedir(), "synthetix-data");
  fs.mkdirSync(root, { recursive: true });
  return `file:${root.replace(/\\/g, "/")}/dev.db`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: resolveDbUrl() },
});
