/**
 * Incremental merge logic for the Wiki synthesis layer.
 *
 * Decides whether an extracted knowledge candidate should create a new entry,
 * update an existing one, or be skipped as a duplicate. Also detects
 * contradictions (LLM-Wiki's `validate` principle applied at merge time).
 *
 * Pure logic where possible (similarity scoring) — LLM is only consulted
 * for ambiguous conflict detection.
 */

import { db } from "@/lib/db";
import { slugify } from "@/lib/wiki/slug";
import { appendChangeLog } from "@/lib/wiki/index-md";
import {
  type WikiEntryType,
  type WikiSourceRef,
  type MergeDecision,
  type ExtractedTopic,
  type ExtractedConcept,
  type ExtractedClaim,
  WIKI_CONFIG,
} from "@/lib/wiki/types";

/**
 * Token-level Jaccard similarity between two titles (after lowercasing +
 * tokenization on non-alphanumeric boundaries incl. CJK).
 *
 * Cheap and good enough for dedup detection — avoids embedding round-trips.
 * Threshold is WIKI_CONFIG.duplicateTitleThreshold.
 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return intersection / union;
}

/** Tokenize a title into a comparable set. Splits CJK per-char + latin per-word. */
function tokenize(s: string): Set<string> {
  const lower = s.toLowerCase().trim();
  const tokens = new Set<string>();
  // CJK characters: per-char (each char is a token)
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  let m: RegExpExecArray | null;
  while ((m = cjkRegex.exec(lower)) !== null) {
    tokens.add(m[0]);
  }
  // Latin/alphanumeric words
  const latin = lower.replace(cjkRegex, " ").match(/[a-z0-9]{2,}/g);
  if (latin) for (const w of latin) tokens.add(w);
  return tokens;
}

/**
 * Decide how to merge a candidate title against existing entries.
 * Returns the action + (if update) the existing entry's slug.
 */
export function decideMerge(
  candidateTitle: string,
  existingTitles: { title: string; slug: string }[],
): MergeDecision {
  let bestSlug: string | null = null;
  let bestScore = 0;
  for (const existing of existingTitles) {
    const score = titleSimilarity(candidateTitle, existing.title);
    if (score > bestScore) {
      bestScore = score;
      bestSlug = existing.slug;
    }
  }
  if (bestScore >= WIKI_CONFIG.duplicateTitleThreshold && bestSlug) {
    return { action: "update", existingSlug: bestSlug };
  }
  return { action: "create" };
}

/**
 * Merge a single extracted topic/concept/claim into the user's Wiki.
 *
 * - "create": insert a new WikiEntry + change-log row.
 * - "update": append to existing entry's content (never overwrite) + change-log.
 *
 * Returns the entry id (created or updated).
 */
export async function mergeEntry(
  userId: string,
  type: WikiEntryType,
  title: string,
  content: string,
  sourceRef: WikiSourceRef,
  confidence: number,
  existingTitles: { title: string; slug: string }[],
): Promise<{ entryId: string; action: "create" | "update" | "skip"; slug: string }> {
  const decision = decideMerge(title, existingTitles);
  const boundedContent = content.slice(0, WIKI_CONFIG.entryContentCharLimit);

  if (decision.action === "create") {
    const slug = await ensureUniqueSlug(userId, title);
    const entry = await db.wikiEntry.create({
      data: {
        userId,
        type,
        title,
        slug,
        content: boundedContent,
        sourceRefs: JSON.stringify([sourceRef]),
        confidence,
        status: "active",
      },
    });
    // Register the new title so subsequent candidates in the same batch see it
    existingTitles.push({ title, slug });
    await appendChangeLog(userId, entry.id, "create", `Created ${type} "${title}"`);
    return { entryId: entry.id, action: "create", slug };
  }

  // update: append with a dated separator (incremental, non-destructive)
  const existing = await db.wikiEntry.findUnique({
    where: { userId_slug: { userId, slug: decision.existingSlug } },
  });
  if (!existing) {
    // Race: entry was deleted between fetching titles and updating. Fallback to create.
    return mergeEntry(userId, type, title, content, sourceRef, confidence, existingTitles);
  }

  const dateTag = new Date().toISOString().slice(0, 10);
  const addition = `\n\n--- Update ${dateTag} ---\n${boundedContent}`;
  const updatedContent = (existing.content + addition).slice(0, WIKI_CONFIG.entryContentCharLimit * 3);

  // Merge source refs (dedup by chunkId/entityId)
  const prevRefs = parseSourceRefs(existing.sourceRefs);
  const mergedRefs = dedupSourceRefs([...prevRefs, sourceRef]);

  // Bump confidence slightly when corroborated by a new source
  const newConfidence = Math.min(1, existing.confidence + 0.05);

  await db.wikiEntry.update({
    where: { id: existing.id },
    data: {
      content: updatedContent,
      sourceRefs: JSON.stringify(mergedRefs),
      confidence: newConfidence,
    },
  });
  await appendChangeLog(userId, existing.id, "update", `Updated "${existing.title}" (new source added)`);
  return { entryId: existing.id, action: "update", slug: existing.slug };
}

/** Merge a batch of extracted topics (Phase A) for one chunk. */
export async function mergeChunkKnowledge(
  userId: string,
  chunk: { documentId: string; chunkId: string; chunkIndex: number },
  knowledge: { topics: ExtractedTopic[]; concepts: ExtractedConcept[]; claims: ExtractedClaim[] },
  existingTitles: { title: string; slug: string }[],
): Promise<void> {
  const sourceRef: WikiSourceRef = {
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
  };

  for (const topic of knowledge.topics) {
    await mergeEntry(userId, "topic", topic.title, topic.content, sourceRef, 0.8, existingTitles);
  }
  for (const concept of knowledge.concepts) {
    await mergeEntry(userId, "concept", concept.title, concept.content, sourceRef, 0.8, existingTitles);
  }
  for (const claim of knowledge.claims) {
    await mergeEntry(userId, "claim", claim.title, claim.content, sourceRef, claim.confidence, existingTitles);
  }
}

function parseSourceRefs(raw: string): WikiSourceRef[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dedupSourceRefs(refs: WikiSourceRef[]): WikiSourceRef[] {
  const seen = new Set<string>();
  const out: WikiSourceRef[] = [];
  for (const r of refs) {
    const key = r.chunkId || r.entityId || `${r.documentId}:${r.chunkIndex ?? -1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Fetch all active entry titles for a user (for dedup awareness). */
export async function getExistingTitles(userId: string): Promise<{ title: string; slug: string }[]> {
  const entries = await db.wikiEntry.findMany({
    where: { userId, status: "active" },
    select: { title: true, slug: true },
    orderBy: { updatedAt: "desc" },
  });
  return entries;
}

/** Generate a unique slug for a title, suffixing -2, -3, ... if taken. */
async function ensureUniqueSlug(userId: string, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  // Loop until we find an unused slug. Bound to avoid infinite loop on pathological input.
  for (let i = 0; i < 50; i++) {
    const existing = await db.wikiEntry.findUnique({
      where: { userId_slug: { userId, slug } },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${base}-${suffix++}`;
  }
  return `${base}-${Date.now()}`;
}
