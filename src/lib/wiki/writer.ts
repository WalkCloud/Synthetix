/**
 * Writeback flywheel — the "update" operation of the LLM-Wiki.
 *
 * After a section is generated, this extracts the section's knowledge
 * contribution and merges it back into the Wiki so subsequent sections
 * benefit. SINGLE-SECTION granularity (never rewrites the whole Wiki):
 * one LLM call reads only the section content, then incremental DB writes.
 *
 * Fire-and-forget by design: the caller invokes `void updateWikiAfterSection(...)`
 * so a writeback failure never blocks section save. The section is already
 * generated successfully; Wiki enrichment is pure upside.
 */

import { db } from "@/lib/db";
import { getLLMClient, type LLMClient } from "@/lib/llm/client";
import { recordTokenUsageSafely } from "@/lib/llm/usage";
import { SECTION_EXTRACTION_PROMPT } from "@/lib/wiki/prompts";
import { getExistingTitles, mergeEntry } from "@/lib/wiki/merger";
import { appendChangeLog } from "@/lib/wiki/index-md";
import { regenerateIndexMd } from "@/lib/wiki/index-md";
import {
  type SectionKnowledge,
  type WikiSourceRef,
  type WikiLinkRelation,
} from "@/lib/wiki/types";

/**
 * Extract knowledge from a generated section and merge it into the Wiki.
 *
 * @param section   The generated section (id, title, content)
 * @param draftId   Owning draft (for provenance in change log)
 * @param userId    User whose Wiki to update
 * @param usedWikiEntryIds  Entry ids that were injected into THIS section's
 *                          context. Their confidence gets bumped (a citation
 *                          is a validation — the LLM-Wiki "validate" signal).
 */
export async function updateWikiAfterSection(
  section: { id: string; title: string; content: string },
  draftId: string,
  userId: string,
  usedWikiEntryIds: string[] = [],
): Promise<{ created: number; updated: number; linked: number }> {
  if (!section.content.trim()) {
    return { created: 0, updated: 0, linked: 0 };
  }

  let client;
  try {
    client = await getLLMClient("writing", userId);
  } catch {
    return { created: 0, updated: 0, linked: 0 };
  }

  const existingTitles = await getExistingTitles(userId);
  const extraction = await extractSectionKnowledge(section, existingTitles, client, userId);
  if (!extraction) return { created: 0, updated: 0, linked: 0 };

  let created = 0;
  let updated = 0;

  const sourceRef: WikiSourceRef = { documentId: draftId }; // section's draft as provenance

  // New claims → create entries
  for (const claim of extraction.newClaims) {
    await mergeEntry(userId, "claim", claim.title, claim.content, sourceRef, claim.confidence, existingTitles);
    created++;
  }

  // Updates to existing topics → append (mergeEntry handles the update path)
  for (const upd of extraction.updatedTopics) {
    const existing = await db.wikiEntry.findUnique({
      where: { userId_slug: { userId, slug: upd.existingSlug } },
      select: { id: true, title: true, content: true, sourceRefs: true, confidence: true },
    });
    if (!existing) continue;

    const dateTag = new Date().toISOString().slice(0, 10);
    const addition = `\n\n--- Update ${dateTag} (from section "${section.title}") ---\n${upd.addition}`;
    const newContent = (existing.content + addition).slice(0, 2400);
    await db.wikiEntry.update({
      where: { id: existing.id },
      data: { content: newContent },
    });
    await appendChangeLog(userId, existing.id, "update", `Appended to "${existing.title}" from section "${section.title}"`);
    updated++;
  }

  // Cross-references → WikiLink edges (OKF link-as-graph)
  let linked = 0;
  for (const ref of extraction.crossRefs) {
    const fromEntry = await db.wikiEntry.findFirst({
      where: { userId, title: { contains: ref.fromTitle } },
      select: { id: true },
    });
    const toEntry = await db.wikiEntry.findFirst({
      where: { userId, title: { contains: ref.toTitle } },
      select: { id: true },
    });
    if (!fromEntry || !toEntry || fromEntry.id === toEntry.id) continue;
    await db.wikiLink
      .upsert({
        where: {
          fromId_toId_relation: { fromId: fromEntry.id, toId: toEntry.id, relation: ref.relation },
        },
        update: {},
        create: { fromId: fromEntry.id, toId: toEntry.id, relation: ref.relation },
      })
      .then(() => { linked++; })
      .catch(() => {});
  }

  // Bump confidence of entries that were cited in this section (validate signal).
  // NOTE: we read-then-write (not Prisma atomic `increment`) because confidence
  // must be clamped to [0, 1] — the atomic increment had no upper bound, so a
  // heavily-cited entry accumulated +0.03 per citation past 1.0 (e.g. 112%).
  // updateMany is skipped here because we need the current value to clamp.
  for (const entryId of usedWikiEntryIds) {
    try {
      const entry = await db.wikiEntry.findFirst({
        where: { id: entryId, userId },
        select: { confidence: true },
      });
      if (!entry) continue;
      const bumped = Math.min(1, entry.confidence + 0.03);
      await db.wikiEntry.update({
        where: { id: entryId },
        data: { confidence: bumped, lastValidatedAt: new Date() },
      });
    } catch {
      // Wiki confidence bump is best-effort — never block the writeback flywheel.
    }
  }

  // Refresh index.md so the browse page reflects the new state
  await regenerateIndexMd(userId).catch(() => {});

  return { created, updated, linked };
}

/**
 * One LLM call to extract a section's knowledge contribution.
 * Reads ONLY the section content + existing titles list (context-bounded).
 */
async function extractSectionKnowledge(
  section: { id: string; title: string; content: string },
  existingTitles: { title: string; slug: string }[],
  client: LLMClient,
  userId: string,
): Promise<SectionKnowledge | null> {
  // Cap section content to keep the call context-bounded
  const cappedContent = section.content.slice(0, 4000);
  const titlesCtx = existingTitles.map((t) => `- ${t.title} (slug: ${t.slug})`).join("\n").slice(0, 2000);

  const response = await client.provider.chat({
    model: client.modelId,
    messages: [
      { role: "system", content: SECTION_EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Section title: ${section.title}\n\nExisting knowledge base entries:\n${titlesCtx || "(empty)"}\n\n--- Section content ---\n${cappedContent}`,
      },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  await recordTokenUsageSafely({
    userId,
    modelConfigId: client.modelConfigId,
    module: "wiki",
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    referenceId: section.id,
  });

  return parseSectionKnowledge(response.content);
}

function parseSectionKnowledge(raw: string): SectionKnowledge | null {
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return null;
  } catch {
    return null;
  }

  const newClaims = parseArray(parsed.newClaims)
    .map((o) => {
      if (typeof o.title !== "string" || typeof o.content !== "string") return null;
      const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0.7;
      return { title: o.title, content: o.content, confidence };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const updatedTopics = parseArray(parsed.updatedTopics)
    .map((o) => {
      if (typeof o.existingSlug !== "string" || typeof o.addition !== "string") return null;
      return { existingSlug: o.existingSlug, addition: o.addition };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const validRelations = new Set(["supports", "contradicts", "relates", "derived_from"]);
  const crossRefs = parseArray(parsed.crossRefs)
    .map((o) => {
      if (typeof o.fromTitle !== "string" || typeof o.toTitle !== "string") return null;
      const relation = (typeof o.relation === "string" && validRelations.has(o.relation) ? o.relation : "relates") as WikiLinkRelation;
      return { fromTitle: o.fromTitle, toTitle: o.toTitle, relation };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { newClaims, updatedTopics, crossRefs };
}

function parseArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
}
