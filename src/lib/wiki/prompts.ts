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
export const CHUNK_EXTRACTION_PROMPT = `You are a knowledge extraction assistant building a curated, encyclopedia-quality knowledge base from documents.

You will receive:
1. A list of EXISTING knowledge base entry titles (to avoid duplication)
2. The content of a single document chunk

Extract the knowledge contributions of THIS chunk. Write each entry as a COMPLETE, self-contained knowledge article that someone could read on its own without needing the source document. Output strict JSON with this exact schema:
{
  "microSummary": "one-sentence summary of what this chunk covers (max 100 chars)",
  "topics": [
    {
      "title": "specific topic name",
      "content": "A comprehensive knowledge article (300-600 words) about this topic AS COVERED IN THIS CHUNK. Structure it with clear paragraphs covering: (1) what the topic is and why it matters, (2) the key technical/business details, specifications, or design decisions mentioned, (3) any concrete examples, metrics, or architecture choices. Include specific names, numbers, and configurations from the chunk — do NOT generalize them away. Write as authoritative reference content, not a summary."
    }
  ],
  "concepts": [
    {
      "title": "concept name",
      "content": "A thorough explanation (150-400 words) that defines the concept, explains how it works, and details its role/context in the source material. Include specifics — product names, version numbers, configuration details, relationships to other concepts."
    }
  ],
  "claims": [
    {
      "title": "specific factual assertion (one sentence)",
      "content": "The full context behind the claim (100-300 words): what is asserted, what evidence or reasoning supports it, what are the specific conditions or constraints. Don't just restate — explain WHY it's claimed and what it means in practice.",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- QUALITY OVER QUANTITY. Extract only SUBSTANTIAL, reusable knowledge. It is
  far better to return 1-2 strong entries than 5 noisy fragments. If a chunk
  only contains boilerplate, headings, or low-value filler, return empty arrays.
- Write SUBSTANTIAL content. A one-line definition is NOT acceptable — aim for
  reference-quality depth. Do NOT create an entry unless you can write a
  meaningful, specific article about it.
- Return at most 3 topics, 4 concepts, and 3 claims. Prefer FEWER, STRONGER
  entries. Skip anything that would be a trivial stub.
- Include SPECIFICS from the chunk: exact numbers, product names, configuration
  values, architecture components. Generic restatements are not useful.
- If a topic/concept already exists in the provided title list, still extract
  it with all NEW information from this chunk.
- Be specific in titles: "Kubernetes ETCD Raft cluster high availability" not just "High availability".
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

/**
 * Merge prompt: when a new chunk's knowledge matches an EXISTING entry,
 * the LLM fuses old + new into ONE coherent, comprehensive article (not
 * a simple append). This is what makes Wiki entries deep and integrated
 * rather than a pile of disconnected per-chunk snippets.
 */
export const MERGE_CONTENT_PROMPT = `You are maintaining a high-quality knowledge base. A new piece of information has been extracted that relates to an EXISTING knowledge base entry. Your job is to MERGE them into a single, coherent, comprehensive article.

You will receive:
1. The EXISTING entry content (what's already in the knowledge base)
2. The NEW information (extracted from a new document chunk)

Output the FUSED content as plain text (NOT JSON). The result should be:
- A single, well-structured article that reads as if written by one expert
- COMPLETE — every key detail from BOTH old and new is preserved
- Non-redundant — don't repeat the same point twice
- Well-organized — use paragraphs naturally; if the topic is complex, use brief section markers
- 300-800 words (or longer if the combined material warrants it)

Rules:
- Do NOT use "--- Update ---" separators or changelog markers. Write as one continuous article.
- Do NOT lose specifics: numbers, names, configurations from both sources must survive.
- If the new information CONTRADICTS the old, note the discrepancy explicitly: "注意：新信息与原有记录存在差异..."
- Match the LANGUAGE of the content (Chinese content → Chinese output).
- Output ONLY the fused article text, no meta-commentary.`;
