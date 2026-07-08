/**
 * Centralised JSON parsing and merging for SectionAsset.metadata.
 *
 * SectionAsset.metadata is a JSON string stored in the DB. Multiple code paths
 * (diagram-generator, image-generator) read it, merge in new fields, and write
 * it back. This helper ensures malformed metadata never crashes generation.
 *
 * Design: §4.5 — persisted JSON parser centralisation.
 */

/**
 * Parse asset metadata JSON string into a plain object.
 * Returns `{}` for null/undefined/empty/malformed values.
 */
export function parseAssetMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Merge a patch into existing asset metadata and return the serialised result.
 *
 * Usage:
 *   const metadata = mergeAssetMetadata(asset.metadata, { spec, generatedAt: ... });
 *   await db.sectionAsset.update({ where: { id }, data: { metadata } });
 */
export function mergeAssetMetadata(
  raw: string | null | undefined,
  patch: Record<string, unknown>,
): string {
  const existing = parseAssetMetadata(raw);
  return JSON.stringify({ ...existing, ...patch });
}
