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

export function mergeSecretUpdates(
  current: UserSettings,
  updates: Partial<UserSettings>,
): UserSettings {
  const merged = { ...current };

  for (const [key, value] of Object.entries(updates)) {
    if (isSecretField(key) && (value === undefined || value === "")) continue;
    (merged as Record<string, unknown>)[key] = value;
  }

  return merged;
}
