import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";
import { mergeSecretUpdates, SECRET_FIELDS } from "@/lib/settings/secrets";

export interface UserSettings {
  storageType?: string;
  localPath?: string;
  cachePath?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
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
  pgPassword?: string;
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

const ENCRYPTED_PREFIX = "enc:v1:";

function getSettingsDir(): string {
  return process.env.SETTINGS_DIR
    ? path.resolve(process.env.SETTINGS_DIR)
    : path.resolve("data/settings");
}

function ensureSettingsDir(): string {
  const dir = getSettingsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
  return dir;
}

function getSettingsPath(userId: string): string {
  return path.join(ensureSettingsDir(), `${userId}.json`);
}

function decryptSettings(raw: UserSettings): UserSettings {
  const settings = { ...raw };
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) continue;
    try {
      (settings as Record<string, unknown>)[key] = decrypt(value.slice(ENCRYPTED_PREFIX.length));
    } catch (error) {
      throw new Error(
        `Failed to decrypt settings field ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return settings;
}

function encryptSettings(settings: UserSettings): Record<string, unknown> {
  const secretFields = new Set<string>(SECRET_FIELDS);
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    cleaned[key] = secretFields.has(key) && typeof value === "string" && value
      ? `${ENCRYPTED_PREFIX}${encrypt(value)}`
      : value;
  }
  return cleaned;
}

export function readSettings(userId: string): UserSettings {
  const filePath = getSettingsPath(userId);
  if (!fs.existsSync(filePath)) return {};

  let parsed: UserSettings;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as UserSettings;
  } catch (error) {
    throw new Error(
      `Settings file exists at ${filePath} but could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return decryptSettings(parsed);
}

export function writeSettings(
  userId: string,
  updates: Partial<UserSettings>,
  clearSecrets: readonly import("@/lib/settings/secrets").SecretField[] = [],
): void {
  const current = readSettings(userId);
  const merged = mergeSecretUpdates(current, updates, clearSecrets);
  const filePath = getSettingsPath(userId);
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(encryptSettings(merged), null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
    fs.renameSync(tmpPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}
