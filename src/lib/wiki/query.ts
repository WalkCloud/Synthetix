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
import { searchWikiFts, isWikiFtsEnabled, removeWikiFtsForEntries } from "@/lib/search/wiki-fts";
import { tokenizeTitle } from "@/lib/wiki/merger";
import type { LLMProvider } from "@/lib/llm/types";
import type { WikiEntryView, WikiSourceRef } from "@/lib/wiki/types";

/** Default cap on how many Wiki entries to inject into a section's context. */
export const DEFAULT_WIKI_QUERY_LIMIT = 5;

/**
 * Whether LLM-based query rewriting is enabled for Wiki retrieval. MemoRAG-style
 * "memory-guided retrieval": rewrite the section query into Wiki-title-aligned
 * search terms so semantically-related entries that don't keyword-match the raw
 * query can still be recalled by the SQL LIKE path. Off = pure tokenized SQL
 * (the original behavior). Default on.
 */
const WIKI_QUERY_REWRITE_ENABLED = process.env.WIKI_QUERY_REWRITE !== "off";

/** Prompt that turns a section brief into Wiki-title-aligned search terms. */
const WIKI_REWRITE_PROMPT = `You expand a writing-section brief into search terms that would match a knowledge-wiki's entry titles and content.

Given the document title, section title, description, and key points, output 5-8 concise search terms (keywords, synonyms, hypernyms, related concepts) most likely to appear in a wiki entry title or body about this topic. Favor noun phrases and domain terminology over full sentences.

Rules:
- Output ONLY a JSON object: {"terms": ["term1", "term2", ...]}
- 5-8 terms, each 1-4 words, deduplicated
- Match the language of the input (Chinese input → Chinese terms)
- Do NOT invent facts; only broaden/align the existing query vocabulary`;

/**
 * Use an LLM to rewrite a section brief into Wiki-title-aligned search terms.
 *
 * This is the "memory-guided retrieval" step borrowed from MemoRAG: instead of
 * feeding the raw section text to the SQL LIKE matcher (which misses entries
 * whose wording differs from the query), we ask the LLM for the vocabulary a
 * Wiki entry on this topic would actually use. The returned terms are merged
 * with the tokenizer's terms in {@link queryWikiForSection}.
 *
 * Non-blocking: on any failure (LLM error, bad JSON, timeout) returns an empty
 * array so the caller falls back to tokenized-only matching.
 */
export async function rewriteWikiQuery(
  section: { title: string; description?: string | null; keyPoints?: string | null },
  draftTitle: string,
  provider: LLMProvider,
  modelId: string,
  retrievalQuery?: string | null,
): Promise<string[]> {
  if (!WIKI_QUERY_REWRITE_ENABLED) return [];

  const context = [
    `Document: ${draftTitle}`,
    section.title && `Section: ${section.title}`,
    section.description && `Scope: ${section.description}`,
    section.keyPoints && `Key points: ${section.keyPoints}`,
    retrievalQuery && `Retrieval intent: ${retrievalQuery}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await provider.chat({
      model: modelId,
      messages: [
        { role: "system", content: WIKI_REWRITE_PROMPT },
        { role: "user", content: context },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const parsed = JSON.parse(response.content.trim()) as Record<string, unknown>;
    const terms = parsed.terms;
    if (!Array.isArray(terms)) return [];
    return terms
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim())
      .slice(0, 12);
  } catch {
    // Wiki is a pure enhancement — never block on the rewrite.
    return [];
  }
}


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
  rewrittenTerms?: string[],
): Promise<WikiEntryView[]> {
  const queryText = buildQueryText(section, draftTitle, retrievalQuery);
  if (!queryText.trim() && (!rewrittenTerms || rewrittenTerms.length === 0)) return [];

  const tokenizedTerms = extractSearchTerms(queryText);
  // Dedupe rewritten vs tokenized (case-insensitive). Rewritten terms that
  // overlap with tokenized ones are dropped from the rewritten set so they
  // don't get double-weighted; they keep their (higher) rewritten weight.
  const rewrittenLower = new Set(tokenizedTerms.map((t) => t.toLowerCase()));
  const uniqueRewritten = (rewrittenTerms ?? []).filter(
    (t) => t.trim() && !rewrittenLower.has(t.trim().toLowerCase()),
  );

  // All terms (for scoring + legacy LIKE) — deduped, capped.
  const allTerms = [...tokenizedTerms, ...uniqueRewritten].slice(0, 30);
  if (allTerms.length === 0) return [];

  // ── Recall phase ────────────────────────────────────────────────────────
  // Two recall strategies, picked by the WIKI_FTS_ENABLED feature flag:
  //   - FTS path (default): jieba-tokenised FTS5 MATCH + a trigram/Jaccard
  //     fallback for fuzzy/typo tolerance that LIKE cannot provide. Returns a
  //     candidate set keyed by entry id with an FTS rank for score tuning.
  //   - Legacy LIKE path (WIKI_FTS_ENABLED=off): the original Prisma `contains`
  //     OR clause. Kept as an instant rollback if FTS misbehaves.
  type Candidate = { entry: Awaited<ReturnType<typeof db.wikiEntry.findMany>>[number]; ftsRank?: number };
  const candidateById = new Map<string, Candidate>();

  if (isWikiFtsEnabled()) {
    // 1) FTS5 recall over the jieba-pre-tokenised index.
    const ftsHits = await searchWikiFts(queryText, userId, limit * 4);
    if (ftsHits.length > 0) {
      const ftsIds = ftsHits.map((h) => h.entryId);
      const ftsEntries = await db.wikiEntry.findMany({ where: { id: { in: ftsIds } } });
      const byId = new Map(ftsEntries.map((e) => [e.id, e] as const));
      for (const hit of ftsHits) {
        const entry = byId.get(hit.entryId);
        if (entry) candidateById.set(hit.entryId, { entry, ftsRank: hit.rank });
      }
    }

    // 2) Trigram/Jaccard fallback: when FTS recall is thin, scan a cheap
    //    LIKE-narrowed candidate set and admit entries whose title is
    //    character-level similar to the query (catches typos, morphological
    //    variants, and terms FTS's tokenisation split differently). This is
    //    the "fuzzy" capability LIKE alone never had.
    if (candidateById.size < limit * 2) {
      const SIM_THRESHOLD = 0.34; // ~1 shared char in 3; tuned for CJK per-char tokens
      const queryTitleTokens = tokenizeTitle(queryText);
      const likeCandidates = await db.wikiEntry.findMany({
        where: {
          userId,
          status: "active",
          OR: allTerms.map((t) => ({ title: { contains: t } })),
        },
        take: limit * 8,
      });
      for (const e of likeCandidates) {
        if (candidateById.has(e.id)) continue;
        const sim = queryTitleTokens.size > 0
          ? jaccard(queryTitleTokens, tokenizeTitle(e.title))
          : 0;
        if (sim >= SIM_THRESHOLD) candidateById.set(e.id, { entry: e });
      }
    }
  } else {
    // Legacy LIKE recall (instant-rollback path).
    const titleConditions = allTerms.map((t) => ({ title: { contains: t } }));
    const contentConditions = allTerms.map((t) => ({ content: { contains: t } }));
    const entries = await db.wikiEntry.findMany({
      where: { userId, status: "active", OR: [...titleConditions, ...contentConditions] },
      take: limit * 4,
      orderBy: { updatedAt: "desc" },
    });
    for (const e of entries) candidateById.set(e.id, { entry: e });
  }

  if (candidateById.size === 0) return [];
  const entries = [...candidateById.values()];

  // ── Score phase (unchanged weights + FTS-rank micro-tune) ───────────────
  //   - title match > content match (3x vs 1x), as before
  //   - LLM-rewritten terms weigh 2x tokenized terms: they are deliberately
  //     chosen to align with wiki vocabulary, so a hit on a rewritten term is
  //     a stronger relevance signal than a generic tokenized word.
  //   - confidence is a multiplier so high-confidence entries surface first.
  //   - when FTS provided a rank, add a small proximity bonus so FTS-best
  //     entries win ties against equally-scored LIKE/trigram admits.
  // A minimum raw score (before confidence) of 2 is required — this filters
  // out entries that match only a single tokenized term in content (score 1),
  // which was the main source of irrelevant noise.
  const MIN_RELEVANCE_SCORE = 2;
  const rewrittenSet = new Set(uniqueRewritten.map((t) => t.toLowerCase()));
  const scored = entries.map(({ entry: e, ftsRank }) => {
    let rawScore = 0;
    const titleLower = e.title.toLowerCase();
    const contentLower = e.content.toLowerCase();
    for (const term of allTerms) {
      const tl = term.toLowerCase();
      const weight = rewrittenSet.has(tl) ? 2 : 1;
      if (titleLower.includes(tl)) rawScore += 3 * weight;
      if (contentLower.includes(tl)) rawScore += 1 * weight;
    }
    // FTS rank is BM25-style (lower = better). Convert to a 0..0.5 bonus.
    const ftsBonus = typeof ftsRank === "number" && ftsRank < 0
      ? 0.5 * (1 / (1 + Math.abs(ftsRank)))
      : 0;
    return { entry: e, rawScore, score: rawScore * (0.5 + e.confidence * 0.5) + ftsBonus };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((s) => s.rawScore >= MIN_RELEVANCE_SCORE)
    .slice(0, limit)
    .filter((s) => s.score > 0)
    .map((s) => toView(s.entry));
}

/** Jaccard similarity over two token sets: |A∩B| / |A∪B|. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
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

/**
 * Delete all Wiki entries sourced from any of the given documents.
 * Called when the user deletes documents and chooses to also delete their
 * distilled knowledge. Entries with MULTIPLE source documents (fused entries)
 * have only the matching refs removed, not the whole entry; entries whose
 * ONLY source was one of the deleted docs are removed entirely.
 *
 * Additionally performs a DEFENSIVE ORPHAN SWEEP: any active entry whose
 * sourceRefs point at a document that no longer exists in the documents
 * table (a leftover from past deletes that failed to clean wiki — the old
 * lifecycle worker bug) is cleaned up the same way. This guarantees wiki
 * never retains references to deleted documents, regardless of when or how
 * they were deleted. The sweep runs only when there's at least one real
 * delete in progress, so it adds no overhead to the steady-state.
 *
 * Single full-table scan regardless of docIds.length (sourceRefs is JSON, so
 * SQLite can't query inside it — we fetch active entries once and filter in
 * memory). Use this batch form in preference to {@link deleteEntriesForDocument}
 * whenever more than one document is being deleted, to avoid re-scanning per doc.
 *
 * Returns { deleted: number, updated: number, orphansPurged: number }.
 */
export async function deleteEntriesForDocuments(
  userId: string,
  documentIds: string[],
): Promise<{ deleted: number; updated: number; orphansPurged: number }> {
  if (documentIds.length === 0) return { deleted: 0, updated: 0, orphansPurged: 0 };

  const targetSet = new Set(documentIds);
  const entries = await db.wikiEntry.findMany({
    where: { userId, status: "active" },
    select: { id: true, sourceRefs: true },
  });

  // Collect every documentId referenced by any active wiki entry, then look up
  // which of them still exist. Entries referencing only non-existent docs are
  // orphans (from past deletes that didn't clean wiki) and get swept here too.
  const referencedDocIds = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.sourceRefs);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r.documentId) referencedDocIds.add(r.documentId);
        }
      }
    } catch { /* malformed — handled per-entry below */ }
  }
  const existing = referencedDocIds.size > 0
    ? await db.document.findMany({
        where: { id: { in: [...referencedDocIds] } },
        select: { id: true },
      })
    : [];
  const existingDocSet = new Set(existing.map((d) => d.id));

  const toDelete: string[] = [];
  const toUpdate: { id: string; sourceRefs: string }[] = [];
  let orphansPurged = 0;

  for (const entry of entries) {
    let refs: WikiSourceRef[] = [];
    try {
      const parsed = JSON.parse(entry.sourceRefs);
      if (Array.isArray(parsed)) refs = parsed;
    } catch { continue; }

    // A ref is "gone" if it points at one of the docs being deleted right now,
    // OR at a doc that doesn't exist in the DB at all (orphan from a prior
    // delete that left wiki dirty). Both cases are treated identically.
    const filtered = refs.filter((r) => {
      const docId = r.documentId ?? "";
      if (targetSet.has(docId)) return false;          // explicitly deleted now
      if (docId && !existingDocSet.has(docId)) return false; // orphan ref
      return true;
    });

    if (filtered.length === 0 && refs.length > 0) {
      // All refs are gone (deleted now or orphan) — delete the entry entirely
      toDelete.push(entry.id);
      // Track whether this entry was solely an orphan (not in this delete batch)
      const onlyOrphans = refs.every((r) => !targetSet.has(r.documentId ?? ""));
      if (onlyOrphans) orphansPurged += 1;
    } else if (filtered.length < refs.length) {
      // Entry still has surviving sources — keep it, strip the dead refs
      toUpdate.push({ id: entry.id, sourceRefs: JSON.stringify(filtered) });
    }
  }

  // Bulk delete entries whose sources are all gone
  if (toDelete.length > 0) {
    await db.wikiEntry.deleteMany({ where: { id: { in: toDelete }, userId } });
    void removeWikiFtsForEntries(toDelete).catch(() => {});
  }

  // Batch-update fused entries (one statement per entry; SQLite has no UPDATE
  // ... FROM json_each, so per-row is unavoidable here, but each is a single
  // indexed PK update — fast even for thousands of rows)
  for (const upd of toUpdate) {
    await db.wikiEntry.update({
      where: { id: upd.id },
      data: { sourceRefs: upd.sourceRefs },
    }).catch(() => {});
  }

  return { deleted: toDelete.length - orphansPurged, updated: toUpdate.length, orphansPurged };
}

/**
 * Delete all Wiki entries sourced from a specific document.
 * Convenience wrapper around {@link deleteEntriesForDocuments} for the
 * single-document case. Kept for call-site compatibility.
 */
export function deleteEntriesForDocument(
  userId: string,
  documentId: string,
): Promise<{ deleted: number; updated: number }> {
  return deleteEntriesForDocuments(userId, [documentId]);
}

/** Aggregate counts for the Wiki browse page stats ribbon. */
export async function getWikiStats(userId: string): Promise<{
  total: number;
  docSummary: number;
  topics: number;
  concepts: number;
  claims: number;
  multiSource: number;
  totalSourceRefs: number;
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

  // Count entries with 2+ source refs (multi-source fused entries) + total refs.
  // sourceRefs is JSON, so we fetch all active entries' refs and count in memory.
  // Wiki sizes are modest (hundreds, not millions) so this is acceptable.
  const allRefs = await db.wikiEntry.findMany({
    where: { userId, status: "active" },
    select: { sourceRefs: true },
  });
  let multiSource = 0;
  let totalSourceRefs = 0;
  for (const entry of allRefs) {
    try {
      const refs = JSON.parse(entry.sourceRefs);
      if (Array.isArray(refs)) {
        totalSourceRefs += refs.length;
        if (refs.length >= 2) multiSource++;
      }
    } catch { /* malformed — skip */ }
  }

  return {
    total: docSummary + topics + concepts + claims,
    docSummary, topics, concepts, claims,
    multiSource, totalSourceRefs,
  };
}

// ---- helpers ----

/**
 * Build the text used to derive search terms for a section.
 *
 * IMPORTANT: the draft (document) title is deliberately EXCLUDED. An earlier
 * version concatenated it, but a generic doc title like "企业管理系统设计文档"
 * injects terms ("企业", "管理", "系统", "设计", "文档") that match almost
 * every wiki entry and drown out the section's own relevance signal. Wiki
 * entries describe distilled knowledge about a TOPIC, so only the section's
 * title/scope/key-points/retrieval-intent are relevant for matching.
 */
function buildQueryText(
  section: { title: string; description?: string | null; keyPoints?: string | null },
  _draftTitle: string,
  retrievalQuery?: string | null,
): string {
  const parts = [
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
 *
 * NOTE: single CJK characters are intentionally NOT added as standalone terms.
 * An earlier version emitted every CJK char in the query text, which made
 * `content LIKE '%的%'` / `LIKE '%设%'` match almost every wiki entry and
 * flooded results with irrelevant noise. Only multi-character tokens (jieba
 * words or latin terms ≥2 chars) are kept — this keeps the LIKE clauses
 * selective enough to recall genuinely relevant entries.
 */
function extractSearchTerms(text: string): string[] {
  // tokenizeChinese returns a space-joined string of jieba-cut tokens.
  const tokenized = tokenizeChinese(text);
  const tokens = tokenized.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const t = tok.trim();
    if (t.length < 2) continue; // single chars (latin or CJK) are too noisy
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
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
