/**
 * LLM prompts for the Wiki synthesis layer.
 *
 * Bilingual-aware (mirrors the auto-tagger + writing prompts pattern).
 * All prompts request strict JSON output for reliable parsing.
 */

/**
 * Phase A: Extract knowledge from a SINGLE chunk.
 *
 * Critical: the prompt only receives ONE chunk's content + the list of
 * existing Wiki titles (for dedup awareness). This guarantees the LLM
 * context window is never exceeded regardless of document size — the
 * document is processed chunk-by-chunk, never whole.
 */
export const CHUNK_EXTRACTION_PROMPT = `You are a knowledge extraction assistant building a curated knowledge base from documents.

You will receive:
1. A list of EXISTING knowledge base entry titles (to avoid duplication)
2. The content of a single document chunk

Extract the knowledge contributions of THIS chunk only. Output strict JSON with this exact schema:
{
  "microSummary": "one-sentence summary of what this chunk covers (max 100 chars)",
  "topics": [
    {"title": "concise topic name", "content": "2-4 sentences synthesizing what this chunk says about this topic"}
  ],
  "concepts": [
    {"title": "concept name", "content": "1-3 sentences defining/explaining this concept"}
  ],
  "claims": [
    {"title": "factual assertion", "content": "the claim stated precisely", "confidence": 0.0-1.0}
  ]
}

Rules:
- Extract ONLY knowledge present in this chunk — do not infer beyond it.
- If a topic/concept already exists in the provided title list, still extract it but MERGE by adding new information in "content".
- Be specific: "REST API rate limiting" not "API".
- Omit empty arrays — if a chunk has no concepts, return [].
- Confidence: 0.9+ for explicit factual statements, 0.7-0.9 for strong inferences, below 0.7 for speculation.
- Match the LANGUAGE of the chunk content (Chinese content → Chinese output).`;

/**
 * Phase B: Generate a document-level summary from collected micro-summaries.
 *
 * The input is the concatenation of per-chunk micro-summaries (already
 * compressed ~5-10x vs raw text), so even a large document fits. For
 * extremely large documents, micro-summaries are batched first (two-layer
 * Reduce).
 */
export const DOC_SUMMARY_PROMPT = `You are synthesizing a document-level summary for a knowledge base entry.

You will receive a list of per-section micro-summaries of a document. Synthesize them into a coherent document summary.

Output strict JSON:
{
  "title": "document title or main subject (derive from the micro-summaries)",
  "content": "200-400 word summary covering: what the document is about, its main themes, key findings or conclusions. Write as flowing prose, NOT bullet points.",
  "keyTopics": ["3-6 main topic names extracted from the summary"]
}

Rules:
- Match the LANGUAGE of the micro-summaries.
- The summary should help a reader decide whether to read the full document.
- Do not invent information not implied by the micro-summaries.`;

/**
 * Writeback flywheel: Extract knowledge contributed by a generated section.
 *
 * This runs AFTER a section is generated. It can create new claims, APPEND
 * to existing entries (never overwrite), and detect cross-references.
 */
export const SECTION_EXTRACTION_PROMPT = `You are maintaining a knowledge base by extracting new knowledge from a freshly written document section.

You will receive:
1. The section title and its generated content
2. A list of EXISTING knowledge base entry titles

Determine what NEW knowledge this section contributes that is NOT already captured.

Output strict JSON:
{
  "newClaims": [
    {"title": "new factual assertion", "content": "the claim", "confidence": 0.0-1.0}
  ],
  "updatedTopics": [
    {"existingSlug": "slug-of-existing-entry", "addition": "new information to APPEND to that entry (do not repeat existing content)"}
  ],
  "crossRefs": [
    {"fromTitle": "title in this section", "toTitle": "existing entry title", "relation": "supports|contradicts|relates|derived_from"}
  ]
}

Rules:
- Only extract genuinely NEW knowledge not already in the knowledge base.
- For updatedTopics, use the EXACT existing slug. If unsure whether an entry exists, put it in newClaims instead.
- For crossRefs, only reference titles that appear in the provided existing list.
- Omit empty arrays.
- Match the LANGUAGE of the section content.`;

/**
 * Helper: build the Phase A prompt's existing-titles context.
 * Keeps the title list short (token-bounded) to stay within budget.
 */
export function buildExistingTitlesContext(titles: string[]): string {
  if (titles.length === 0) {
    return "Existing knowledge base: (empty — this is the first entry)";
  }
  return `Existing knowledge base entry titles (avoid duplicating these):\n${titles.map((t) => `- ${t}`).join("\n")}`;
}
