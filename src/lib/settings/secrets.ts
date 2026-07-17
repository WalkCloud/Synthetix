import type { UserSettings } from "@/lib/settings/store";

export const SECRET_FIELDS = [
  "s3AccessKey",
  "s3SecretKey",
  "minioAccessKey",
  "pgPassword",
  "ragPgUrl",
  "ragPgPassword",
  "ragNeo4jPassword",
  "ragMilvusToken",
  "ragMilvusPassword",
  "ragQdrantApiKey",
] as const satisfies readonly (keyof UserSettings)[];

export type SecretField = (typeof SECRET_FIELDS)[number];

const SECRET_FIELD_SET = new Set<keyof UserSettings>(SECRET_FIELDS);

export interface MaskedSecret {
  configured: boolean;
  masked: string;
}

export function isSecretField(field: string): field is SecretField {
  return SECRET_FIELD_SET.has(field as keyof UserSettings);
}

export function maskSecret(value: string | null | undefined): MaskedSecret {
  if (!value) return { configured: false, masked: "" };
  return { configured: true, masked: `••••${value.slice(-4)}` };
}

export class InvalidSecretUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSecretUpdateError";
  }
}

export function parseClearSecrets(value: unknown): SecretField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidSecretUpdateError("clearSecrets must be an array");
  const fields = new Set<SecretField>();
  for (const field of value) {
    if (typeof field !== "string" || !isSecretField(field)) {
      throw new InvalidSecretUpdateError(`Cannot clear unknown or non-secret field: ${String(field)}`);
    }
    fields.add(field);
  }
  return [...fields];
}

export function mergeSecretUpdates(
  current: UserSettings,
  updates: Partial<UserSettings>,
  clearSecrets: readonly SecretField[] = [],
): UserSettings {
  const merged = { ...current };
  const clearSet = new Set<SecretField>(clearSecrets);

  for (const [key, value] of Object.entries(updates)) {
    if (isSecretField(key)) {
      if (clearSet.has(key) && value !== undefined && value !== "") {
        throw new InvalidSecretUpdateError(`Cannot replace and clear secret in the same request: ${key}`);
      }
      if (value === undefined || value === "") continue;
    }
    (merged as Record<string, unknown>)[key] = value;
  }

  for (const field of clearSet) delete merged[field];
  return merged;
}
