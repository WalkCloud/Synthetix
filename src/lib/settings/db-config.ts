import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

export interface DbGlobalConfig {
  dbType: "sqlite" | "postgresql";
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  updatedAt?: string;
}

function getConfigPath(): string {
  const settingsDir = process.env.SETTINGS_DIR
    ? path.resolve(process.env.SETTINGS_DIR)
    : path.join(process.cwd(), "data", "settings");
  return path.join(settingsDir, "database.json");
}

function requireEncryptionKey(): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "FATAL: ENCRYPTION_KEY environment variable is required for database credential encryption. " +
      "Set it before starting the server.",
    );
  }
  return process.env.ENCRYPTION_KEY;
}

function decryptLegacyCbc(encoded: string): string {
  const key = requireEncryptionKey();
  const parts = encoded.split(":");
  if (parts.length !== 2) throw new Error("Invalid legacy database password format");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key.padEnd(32).slice(0, 32), "utf8"),
    iv,
  );
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptPassword(encoded: string): string {
  if (encoded.startsWith(ENCRYPTED_PREFIX)) {
    return decrypt(encoded.slice(ENCRYPTED_PREFIX.length));
  }
  return decryptLegacyCbc(encoded);
}

function ensureConfigDir(configPath: string): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

export function readDbGlobalConfig(): DbGlobalConfig | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (raw.dbType !== "postgresql") return null;
    if (!raw.pgHost || !raw.pgDatabase) return null;
    return {
      ...raw,
      pgPassword: raw.pgPassword ? decryptPassword(raw.pgPassword) : "",
    };
  } catch (error) {
    throw new Error(
      `Database config file exists at ${configPath} but could not be read. ` +
      `Fix or delete the file to use default SQLite. Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeDbGlobalConfig(config: Omit<DbGlobalConfig, "updatedAt">): void {
  const configPath = getConfigPath();
  ensureConfigDir(configPath);

  const data: Record<string, unknown> = {
    dbType: config.dbType,
    pgHost: config.pgHost || undefined,
    pgPort: config.pgPort || 5432,
    pgDatabase: config.pgDatabase || undefined,
    pgUser: config.pgUser || undefined,
    pgPassword: config.pgPassword ? `${ENCRYPTED_PREFIX}${encrypt(config.pgPassword)}` : undefined,
    updatedAt: new Date().toISOString(),
  };

  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }

  const tmpPath = `${configPath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
    fs.renameSync(tmpPath, configPath);
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

export function buildPgConnectionString(config: DbGlobalConfig): string {
  const encodedUser = encodeURIComponent(config.pgUser);
  const encodedPassword = encodeURIComponent(config.pgPassword);
  const encodedHost = encodeURIComponent(config.pgHost);
  const encodedDb = encodeURIComponent(config.pgDatabase);
  return `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${config.pgPort}/${encodedDb}`;
}
