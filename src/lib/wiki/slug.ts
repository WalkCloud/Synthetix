/**
 * URL-safe slug generation for Wiki entries.
 *
 * Realizes the OKF "file path is identity" principle: each entry has a
 * stable, URL-safe slug that uniquely identifies it per user. Used in the
 * @@unique([userId, slug]) constraint and as the OKF export filename.
 */

/**
 * Convert a title to a URL-safe slug.
 *
 * - Latin: lowercase, non-alphanumeric → hyphen, collapse repeats, trim.
 * - CJK: romanize to pinyin is NOT attempted (adds heavy deps + ambiguity);
 *   instead each CJK char is kept as-is — CJK is valid in URL paths and
 *   keeps the slug human-meaningful to the user. Surrounding punctuation
 *   is still stripped.
 */
export function slugify(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return `entry-${Date.now()}`;

  let out = "";
  let lastWasHyphen = false;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0)!;
    const isCjk = isCjkCodePoint(code);
    const isAlnum = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
    if (isCjk || isAlnum) {
      out += ch.toLowerCase();
      lastWasHyphen = false;
    } else if (ch >= "A" && ch <= "Z") {
      out += ch.toLowerCase();
      lastWasHyphen = false;
    } else if (!lastWasHyphen && out.length > 0) {
      out += "-";
      lastWasHyphen = true;
    }
  }
  const result = out.replace(/^-+|-+$/g, "");
  return result || `entry-${Date.now()}`;
}

function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
    (code >= 0xac00 && code <= 0xd7af)    // Hangul
  );
}
