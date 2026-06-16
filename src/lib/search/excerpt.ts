function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractQueryTerms(query?: string): string[] {
  const normalized = (query || "").trim();
  if (!normalized) return [];

  const terms = new Set<string>();
  terms.add(normalized);

  const asciiTerms = normalized.match(/[A-Za-z0-9_-]+/g) || [];
  for (const term of asciiTerms) {
    if (term.length >= 2) terms.add(term);
  }

  const cjkTerms = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const term of cjkTerms) {
    if (term.length <= 4) {
      if (term.length >= 2) terms.add(term);
      continue;
    }
    for (let i = 0; i < term.length - 1; i += 2) {
      terms.add(term.slice(i, Math.min(i + 2, term.length)));
    }
  }

  return [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
}

function findBestMatchIndex(content: string, terms: string[]): number {
  for (const term of terms) {
    const idx = content.indexOf(term);
    if (idx >= 0) return idx;
  }

  for (const term of terms) {
    const re = new RegExp(escapeRegExp(term), "i");
    const match = content.match(re);
    if (match?.index !== undefined) return match.index;
  }

  return -1;
}

export function buildSearchExcerpt(content: string, query?: string, maxChars = 1200): string {
  const clean = (content || "").trim();
  if (!clean) return "";
  if (!query?.trim()) return clean;
  if (clean.length <= maxChars) return clean;

  const terms = extractQueryTerms(query);
  const matchIndex = findBestMatchIndex(clean, terms);

  if (matchIndex < 0) {
    return `${clean.slice(0, maxChars).trim()}...`;
  }

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(clean.length, start + maxChars);
  const excerpt = clean.slice(start, end).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < clean.length ? "..." : "";
  return `${prefix}${excerpt}${suffix}`;
}
