import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDbGlobalConfig, writeDbGlobalConfig } from "@/lib/settings/db-config";
import { readSettings, writeSettings } from "@/lib/settings/store";

let tempDir: string;
const originalSettingsDir = process.env.SETTINGS_DIR;
const encryptionKey = process.env.ENCRYPTION_KEY!;

function settingsFile(userId: string): string {
  return path.join(tempDir, `${userId}.json`);
}

function legacyCbcEncrypt(value: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(encryptionKey.padEnd(32).slice(0, 32), "utf8");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

describe("settings encryption at rest", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "synthetix-settings-"));
    process.env.SETTINGS_DIR = tempDir;
  });

  afterEach(() => {
    if (originalSettingsDir === undefined) delete process.env.SETTINGS_DIR;
    else process.env.SETTINGS_DIR = originalSettingsDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("encrypts secret values on disk and decrypts them for callers", () => {
    writeSettings("user-1", {
      s3Bucket: "documents",
      s3SecretKey: "plain-secret-value",
      ragQdrantApiKey: "qdrant-secret-value",
    });

    const onDisk = fs.readFileSync(settingsFile("user-1"), "utf8");
    expect(onDisk).not.toContain("plain-secret-value");
    expect(onDisk).not.toContain("qdrant-secret-value");
    expect(JSON.parse(onDisk).s3SecretKey).toMatch(/^enc:v1:/);
    expect(readSettings("user-1")).toMatchObject({
      s3Bucket: "documents",
      s3SecretKey: "plain-secret-value",
      ragQdrantApiKey: "qdrant-secret-value",
    });
  });

  it("reads legacy plaintext and migrates it on the next write", () => {
    fs.writeFileSync(settingsFile("legacy-user"), JSON.stringify({
      s3SecretKey: "legacy-plaintext",
      s3Bucket: "old-bucket",
    }));

    expect(readSettings("legacy-user").s3SecretKey).toBe("legacy-plaintext");
    writeSettings("legacy-user", { s3Bucket: "new-bucket" });

    const onDisk = fs.readFileSync(settingsFile("legacy-user"), "utf8");
    expect(onDisk).not.toContain("legacy-plaintext");
    expect(JSON.parse(onDisk).s3SecretKey).toMatch(/^enc:v1:/);
  });

  it("fails closed when encrypted settings are tampered with", () => {
    writeSettings("tampered-user", { s3SecretKey: "do-not-lose" });
    const filePath = settingsFile("tampered-user");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    raw.s3SecretKey = `${raw.s3SecretKey.slice(0, -2)}aa`;
    fs.writeFileSync(filePath, JSON.stringify(raw));

    expect(() => readSettings("tampered-user")).toThrow(/decrypt|authenticate|settings/i);
    expect(() => writeSettings("tampered-user", { s3Bucket: "must-not-overwrite" })).toThrow();
    expect(fs.readFileSync(filePath, "utf8")).not.toContain("must-not-overwrite");
  });

  it("preserves existing secrets when an update supplies empty values", () => {
    writeSettings("merge-user", { s3SecretKey: "existing-secret", s3Bucket: "old" });
    writeSettings("merge-user", { s3SecretKey: "", s3Bucket: "new" });
    expect(readSettings("merge-user")).toMatchObject({
      s3SecretKey: "existing-secret",
      s3Bucket: "new",
    });
  });

  it("reads legacy database CBC credentials and writes new GCM envelopes", () => {
    const dbPath = path.join(tempDir, "database.json");
    fs.writeFileSync(dbPath, JSON.stringify({
      dbType: "postgresql",
      pgHost: "localhost",
      pgPort: 5432,
      pgDatabase: "synthetix",
      pgUser: "postgres",
      pgPassword: legacyCbcEncrypt("legacy-db-password"),
    }));

    expect(readDbGlobalConfig()?.pgPassword).toBe("legacy-db-password");

    writeDbGlobalConfig({
      dbType: "postgresql",
      pgHost: "db.internal",
      pgPort: 5432,
      pgDatabase: "synthetix",
      pgUser: "app",
      pgPassword: "new-db-password",
    });

    const onDisk = fs.readFileSync(dbPath, "utf8");
    expect(onDisk).not.toContain("new-db-password");
    expect(JSON.parse(onDisk).pgPassword).toMatch(/^enc:v1:/);
    expect(readDbGlobalConfig()?.pgPassword).toBe("new-db-password");
  });
});
