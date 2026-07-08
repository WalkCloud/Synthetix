/**
 * Centralised JSON parsing for WikiEntry.sourceRefs.
 *
 * sourceRefs is a JSON string array stored in the DB. Multiple wiki query/maintenance
 * paths read and filter it. This helper ensures malformed sourceRefs never crashes
 * wiki queries or cleanup.
 *
 * Design: §4.5 — persisted JSON parser centralisation.
 */

export interface WikiSourceRef {
  documentId?: string;
  chunkId?: string;
  chunkIndex?: number;
  [key: string]: unknown;
}

/**
 * Parse WikiEntry.sourceRefs JSON string into an array.
 * Returns `[]` for null/undefined/empty/malformed values.
 */
export function parseWikiSourceRefs(raw: string | null | undefined): WikiSourceRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is WikiSourceRef => typeof item === "object" && item !== null,
    );
  } catch {
    return [];
  }
}
