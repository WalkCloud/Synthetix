/**
 * Wiki retrieval for the writing pipeline.
 *
 * The "cheap retrieval" half of the LLM-Wiki flywheel: when generating a
 * section, the generator FIRST queries the Wiki (pure SQL, no LLM call,
 * no embedding round-trip) and only falls back to raw RAG when the Wiki
 * has insufficient coverage. This is what makes the flywheel amortize —
 * synthesized knowledge is reused instead of rediscovered per query.
 */

import { db } from "@/lib/db";
import { tokenizeChinese } from "@/lib/search/tokenizer";
import type { WikiEntryView } from "@/lib/wiki/types";

/** Default cap on how many Wiki entries to inject into a section's context. */
export const DEFAULT_WIKI_QUERY_LIMIT = 5;

/**
 * Find Wiki entries relevant to a section being generated.
 *
 * Strategy: tokenize the section's title + keyPoints + retrievalQuery into
 * search terms (reusing the jieba-based tokenizer from the search lib),
 * then SQL-match against entry titles + content. Ranks by a lightweight
 * relevance score (term frequency in title > content) weighted by the
 * entry's confidence. Pure SQL — no LLM, no embeddings.
 *
 * Returns at most `limit` entries, best first.
 */
export async function queryWikiForSection(
  section: { title: string; description?: string | null; keyPoints?: string | null },
  draftTitle: string,
  userId: string,
  retrievalQuery?: string | null,
  limit = DEFAULT_WIKI_QUERY_LIMIT,
): Promise<WikiEntryView[]> {
  const queryText = buildQueryText(section, draftTitle, retrievalQuery);
  if (!queryText.trim()) return [];

  const terms = extractSearchTerms(queryText);
  if (terms.length === 0) return [];

  // Build OR conditions for each term against title + content.
  // SQLite LIKE is case-insensitive for ASCII by default; for CJK we rely on
  // substring match (each CJK char is its own token).
  const titleConditions = terms.map((t) => ({ title: { contains: t } }));
  const contentConditions = terms.map((t) => ({ content: { contains: t } }));

  const entries = await db.wikiEntry.findMany({
    where: {
      userId,
      status: "active",
      OR: [
        ...titleConditions,
        ...contentConditions,
      ],
    },
    take: limit * 4, // over-fetch, then re-rank in memory
    orderBy: { updatedAt: "desc" },
  });

  if (entries.length === 0) return [];

  // Score: title matches weigh 3x content matches; confidence is a multiplier.
  const scored = entries.map((e) => {
    let score = 0;
    const titleLower = e.title.toLowerCase();
    const contentLower = e.content.toLowerCase();
    for (const term of terms) {
      const tl = term.toLowerCase();
      if (titleLower.includes(tl)) score += 3;
      if (contentLower.includes(tl)) score += 1;
    }
    // Normalize by confidence so high-confidence entries surface first
    score *= 0.5 + e.confidence * 0.5;
    return { entry: e, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, limit)
    .filter((s) => s.score > 0)
    .map((s) => toView(s.entry));
}

/**
 * Get a single Wiki entry by id (for detail view / evidence).
 */
export async function getWikiEntry(userId: string, entryId: string): Promise<WikiEntryView | null> {
  const entry = await db.wikiEntry.findFirst({
    where: { id: entryId, userId },
  });
  return entry ? toView(entry) : null;
}

/**
 * Get all entries sourced from a specific document (for the document-detail
 * "knowledge precipitated" card — front-end layer 3).
 */
export async function getEntriesForDocument(userId: string, documentId: string): Promise<WikiEntryView[]> {
  // sourceRefs is JSON; SQLite can't query inside JSON, so we fetch active
  // entries and filter in memory. Wiki sizes are modest (hundreds, not
  // millions) so this is acceptable.
  const entries = await db.wikiEntry.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  return entries
    .filter((e) => {
      try {
        const refs = JSON.parse(e.sourceRefs) as Array<{ documentId?: string }>;
        return Array.isArray(refs) && refs.some((r) => r.documentId === documentId);
      } catch {
        return false;
      }
    })
    .map(toView);
}

/** Aggregate counts per type for the Wiki browse page stats ribbon. */
export async function getWikiStats(userId: string): Promise<{
  total: number;
  docSummary: number;
  topics: number;
  concepts: number;
  claims: number;
}> {
  const active = await db.wikiEntry.groupBy({
    by: ["type"],
    where: { userId, status: "active" },
    _count: true,
  });
  const counts = new Map(active.map((g) => [g.type, g._count]));
  const docSummary = counts.get("doc_summary") ?? 0;
  const topics = counts.get("topic") ?? 0;
  const concepts = counts.get("concept") ?? 0;
  const claims = counts.get("claim") ?? 0;
  return { total: docSummary + topics + concepts + claims, docSummary, topics, concepts, claims };
}

// ---- helpers ----

function buildQueryText(
  section: { title: string; description?: string | null; keyPoints?: string | null },
  draftTitle: string,
  retrievalQuery?: string | null,
): string {
  const parts = [
    draftTitle,
    section.title,
    section.description,
    section.keyPoints,
    retrievalQuery,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.join(" ");
}

/**
 * Extract search terms using the same jieba tokenizer as FTS (ensures CJK
 * is segmented consistently with the rest of the search pipeline).
 * Dedupes + drops trivially short tokens.
 */
function extractSearchTerms(text: string): string[] {
  // tokenizeChinese returns a space-joined string of jieba-cut tokens.
  const tokenized = tokenizeChinese(text);
  const tokens = tokenized.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const t = tok.trim();
    if (t.length < 2) continue; // skip single chars (unless CJK — handled below)
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  // Also include individual CJK chars (each is meaningful for substring match)
  const cjk = text.match(/[\u4e00-\u9fff]/g);
  if (cjk) {
    for (const ch of [...new Set(cjk)]) {
      if (!seen.has(ch)) {
        seen.add(ch);
        out.push(ch);
      }
    }
  }
  return out.slice(0, 20); // cap terms to avoid huge OR clause
}

function toView(e: {
  id: string; userId: string; type: string; title: string; slug: string;
  content: string; sourceRefs: string; confidence: number; status: string;
  lastValidatedAt: Date | null; createdAt: Date; updatedAt: Date;
}): WikiEntryView {
  let sourceRefs: WikiEntryView["sourceRefs"] = [];
  try {
    const parsed = JSON.parse(e.sourceRefs);
    if (Array.isArray(parsed)) sourceRefs = parsed;
  } catch { /* malformed — default to empty */ }
  return {
    id: e.id,
    userId: e.userId,
    type: e.type as WikiEntryView["type"],
    title: e.title,
    slug: e.slug,
    content: e.content,
    sourceRefs,
    confidence: e.confidence,
    status: e.status as WikiEntryView["status"],
    lastValidatedAt: e.lastValidatedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
