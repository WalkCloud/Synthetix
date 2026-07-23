import crypto from "node:crypto";
import { db } from "@/lib/db";
import type { AuthUser } from "@/types/auth";

/**
 * API access-key module.
 *
 * Enables programmatic clients (e.g. an MCP server) to authenticate via
 * `Authorization: Bearer <key>`, as an alternative to cookie/JWT login.
 *
 * Security model:
 *   - The plaintext key is returned to the client exactly once at creation.
 *   - The database stores only a SHA-256 hash plus display-only prefix/last-4;
 *     the plaintext is never persisted.
 *   - Revocation is a soft delete (sets `revokedAt`) to preserve audit history.
 */

/** Recognizable prefix of a plaintext key, to aid human identification. */
export const API_KEY_PREFIX = "sk-synt-";

/** Random body length in bytes; base64url-encodes to ~32 characters. */
const RANDOM_BYTES = 24;

/**
 * Generate a new API key plaintext plus the derived data needed for storage.
 * Call only at creation; the returned `plaintext` must be handed back to the
 * client immediately and is never retrievable afterwards.
 */
export function generateApiKeyMaterial(name: string): {
  plaintext: string;
  hashedKey: string;
  keyPrefix: string;
  keyLast4: string;
  name: string;
} {
  const random = crypto.randomBytes(RANDOM_BYTES).toString("base64url");
  const plaintext = `${API_KEY_PREFIX}${random}`;
  return {
    plaintext,
    hashedKey: hashApiKey(plaintext),
    keyPrefix: API_KEY_PREFIX,
    keyLast4: plaintext.slice(-4),
    name,
  };
}

/** SHA-256 hash a plaintext key, returning a hex digest. */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Extract the bearer token from an `Authorization` header value.
 * Accepts the `"Bearer <token>"` form (case-insensitive); null otherwise.
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1].trim() : null;
}

/**
 * Validate a bearer token and resolve the authenticated user.
 *
 * Flow: extract plaintext -> SHA-256 hash -> look up the `api_keys` table
 * (non-revoked only) -> on hit, update `lastUsedAt` and return the user;
 * returns null on any failure (never throws).
 *
 * `lastUsedAt` write failure is swallowed since it is audit-only and must
 * not block authentication.
 */
export async function resolveApiKeyUser(
  authorizationHeader: string | null | undefined,
): Promise<AuthUser | null> {
  const plaintext = extractBearerToken(authorizationHeader);
  if (!plaintext) return null;

  const hashedKey = hashApiKey(plaintext);
  const record = await db.apiKey.findFirst({
    where: { hashedKey, revokedAt: null },
    include: { user: true },
  });
  if (!record) return null;

  // Refresh last-used timestamp asynchronously; failure won't block auth.
  db.apiKey
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* audit-only field; ignore write failures */
    });

  const { user } = record;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role as AuthUser["role"],
  };
}
