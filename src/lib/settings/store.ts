import fs from "fs";
import path from "path";
import crypto from "crypto";

interface UserSettings {
  storageType?: string;
  localPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKey?: string;
  minioEndpoint?: string;
  minioBucket?: string;
  minioAccessKey?: string;
  quotaGB?: number;
  dbType?: string;
  sqlitePath?: string;
  pgHost?: string;
  pgPort?: number;
  pgDatabase?: string;
  pgUser?: string;
  // RAG / Vector DB settings
  ragVectorDb?: string;
  ragPgUrl?: string;
  ragPgHost?: string;
  ragPgPort?: number;
  ragPgDatabase?: string;
  ragPgUser?: string;
  ragPgPassword?: string;
  ragNeo4jUri?: string;
  ragNeo4jUser?: string;
  ragNeo4jPassword?: string;
  ragMilvusUri?: string;
  ragMilvusToken?: string;
  ragMilvusUser?: string;
  ragMilvusPassword?: string;
  ragMilvusDbName?: string;
  ragQdrantUrl?: string;
  ragQdrantApiKey?: string;
}

const SETTINGS_DIR = path.resolve("data/settings");

function getSettingsPath(userId: string): string {
  const dir = path.join(SETTINGS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${userId}.json`);
}

export function readSettings(userId: string): UserSettings {
  const filePath = getSettingsPath(userId);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

export function writeSettings(userId: string, updates: Partial<UserSettings>): void {
  const current = readSettings(userId);
  const merged = { ...current, ...updates };
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) cleaned[k] = v;
  }
  const filePath = getSettingsPath(userId);
  const tmpPath = filePath + ".tmp." + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmpPath, JSON.stringify(cleaned, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}
