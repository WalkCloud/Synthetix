import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONFIG_PATH = path.join(process.cwd(), "data", "settings", "database.json");

export interface DbGlobalConfig {
  dbType: "sqlite" | "postgresql";
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  updatedAt?: string;
}

function requireEncryptionKey(): string {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "FATAL: ENCRYPTION_KEY environment variable is required for database credential encryption. " +
      "Set it before starting the server."
    );
  }
  return process.env.ENCRYPTION_KEY;
}

function encrypt(data: string): string {
  const key = requireEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key.padEnd(32).slice(0, 32), "utf-8"), iv);
  let encrypted = cipher.update(data, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encoded: string): string {
  const key = requireEncryptionKey();
  const parts = encoded.split(":");
  if (parts.length !== 2) return "";
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key.padEnd(32).slice(0, 32), "utf-8"), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

export function readDbGlobalConfig(): DbGlobalConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (raw.dbType !== "postgresql") return null;
    if (!raw.pgHost || !raw.pgDatabase) return null;
    return {
      ...raw,
      pgPassword: raw.pgPassword ? decrypt(raw.pgPassword) : "",
    };
  } catch {
    return null;
  }
}

export function writeDbGlobalConfig(config: Omit<DbGlobalConfig, "updatedAt">): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data: Record<string, unknown> = {
    dbType: config.dbType,
    pgHost: config.pgHost || undefined,
    pgPort: config.pgPort || 5432,
    pgDatabase: config.pgDatabase || undefined,
    pgUser: config.pgUser || undefined,
    pgPassword: config.pgPassword ? encrypt(config.pgPassword) : undefined,
    updatedAt: new Date().toISOString(),
  };

  // Remove undefined keys
  for (const k of Object.keys(data)) {
    if (data[k] === undefined) delete data[k];
  }

  const tmpPath = CONFIG_PATH + ".tmp." + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, CONFIG_PATH);
}

export function buildPgConnectionString(config: DbGlobalConfig): string {
  const encodedUser = encodeURIComponent(config.pgUser);
  const encodedPassword = encodeURIComponent(config.pgPassword);
  const encodedHost = encodeURIComponent(config.pgHost);
  const encodedDb = encodeURIComponent(config.pgDatabase);
  return `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${config.pgPort}/${encodedDb}`;
}
