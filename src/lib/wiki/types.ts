/**
 * Type definitions for the Wiki synthesis layer.
 *
 * The Wiki layer sits ABOVE the raw chunks + graph layers — it is an
 * LLM-maintained, human-readable, ever-accumulating knowledge base inspired
 * by Karpathy's LLM-Wiki and the OKF portable format. See
 * docs/wiki-synthesis-layer-design-2026-06-22.md for the full design.
 */

/** Wiki entry types, forming different granularities of synthesized knowledge. */
export type WikiEntryType = "doc_summary" | "topic" | "concept" | "claim";

/** Lifecycle status of a Wiki entry. */
export type WikiEntryStatus = "active" | "superseded" | "conflicting";

/** Typed relations between Wiki entries (OKF "links form the graph"). */
export type WikiLinkRelation = "relates" | "supports" | "contradicts" | "derived_from";

/** Change-log actions (one row per mutation, backs the human-readable log.md). */
export type WikiChangeAction = "create" | "update" | "merge" | "supersede" | "conflict";

/**
 * A single source reference proving where a Wiki entry's knowledge came from.
 * Stored as JSON in `WikiEntry.sourceRefs` (lightweight, mirrors
 * SectionReference.sourceType design — avoids a heavy join table for a
 * many-to-many that mutates frequently).
 */
export interface WikiSourceRef {
  documentId: string;
  chunkId?: string;
  chunkIndex?: number;
  entityId?: string;
}

/** A view of a Wiki entry used across the wiki lib modules. */
export interface WikiEntryView {
  id: string;
  userId: string;
  type: WikiEntryType;
  title: string;
  slug: string;
  content: string;
  sourceRefs: WikiSourceRef[];
  confidence: number;
  status: WikiEntryStatus;
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Knowledge extracted from a single chunk by the LLM during Phase A
 * (per-chunk incremental synthesis). This is the unit of work that flows
 * into the merger.
 */
export interface ChunkKnowledge {
  /** Short summary of THIS chunk only (≤100 chars). Fed into Phase B layering. */
  microSummary: string;
  topics: ExtractedTopic[];
  concepts: ExtractedConcept[];
  claims: ExtractedClaim[];
}

export interface ExtractedTopic {
  title: string;
  content: string;
}

export interface ExtractedConcept {
  title: string;
  content: string;
}

export interface ExtractedClaim {
  title: string;
  content: string;
  confidence: number;
}

/**
 * Knowledge extracted from a generated section by the writeback flywheel
 * (Phase 5). Unlike ChunkKnowledge (which creates new entries), this can
 * also UPDATE existing entries and create cross-reference links.
 */
export interface SectionKnowledge {
  newClaims: ExtractedClaim[];
  /** Additions to existing entries (append, never overwrite). */
  updatedTopics: { existingSlug: string; addition: string }[];
  crossRefs: { fromTitle: string; toTitle: string; relation: WikiLinkRelation }[];
}

/** Merge decision for a candidate against existing entries. */
export type MergeDecision =
  | { action: "create" }
  | { action: "update"; existingSlug: string };

/**
 * Compute the Wiki Phase-A input cap (max tokens of a single input unit fed to
 * the LLM) from the writing model's context window.
 *
 * Replaces the old fixed `chunkMaxTokens = 2000`, which under-used modern LLM
 * contexts and forced every chunk through a 2K-token window — wasting context
 * and hurting Wiki quality. The cap is now dynamic:
 *
 *   wikiInputMaxTokens = clamp(floor(contextWindow * 0.08), 4000, WIKI_INPUT_MAX_TOKENS)
 *
 * Conservative 8% ratio: Wiki extraction emits structured JSON, and large
 * inputs raise the JSON-invalid rate + latency. Start small, raise the cap
 * based on observed metrics (jsonRepairFailures, latency). Env overrides
 * (WIKI_INPUT_TOKEN_RATIO, WIKI_INPUT_MAX_TOKENS) let operators tune without
 * a redeploy.
 */
export function resolveWikiInputMaxTokens(contextWindow: number): number {
  const ratio = Number(process.env.WIKI_INPUT_TOKEN_RATIO) || 0.08;
  const lo = 4000;
  const hi = Number(process.env.WIKI_INPUT_MAX_TOKENS) || 16000;
  const cw = contextWindow > 0 ? contextWindow : 200000;
  return Math.max(lo, Math.min(hi, Math.floor(cw * ratio)));
}

/** Thresholds + tunables for the synthesis pipeline. */
export const WIKI_CONFIG = {
  /**
   * Default Wiki Phase-A input cap. Used only as a fallback when no
   * writing-model context window is resolvable at runtime; otherwise
   * resolveWikiInputMaxTokens() computes a dynamic value from the model's
   * contextWindow. Raised from the old fixed 2000 to a sane 4000 floor.
   */
  chunkMaxTokens: 4000,
  /** Max tokens of existing Wiki titles list included in the Phase A prompt. */
  titlesListMaxTokens: 400,
  /** Char limit for a single entry's content (allows substantial reference-quality articles). */
  entryContentCharLimit: 3000,
  /** Min title similarity (Jaccard on tokens) to consider two entries the same. */
  duplicateTitleThreshold: 0.45,
  /** How many chunks' micro-summaries can be combined before Phase B batches them. */
  docSummaryBatchChars: 6000,
  /** Local scheduler ceiling; provider-side AdaptiveLimiter still decides real concurrency. */
  extractSchedulerConcurrency: 16,
  /** Max high-value items accepted from one chunk/segment; avoids noisy LLM
   *  over-extraction that produces many tiny low-value fragments. Tightened
   *  (was 5/8/8) to favor fewer, stronger, reference-quality entries. */
  maxTopicsPerChunk: 3,
  maxConceptsPerChunk: 4,
  maxClaimsPerChunk: 3,
  /** Minimum content length for a Wiki entry to be kept. Entries shorter than
   *  this after merge are dropped (or merged into the closest existing entry) —
   *  they add noise without reference value. Tuned to exclude one-line stubs. */
  minEntryContentChars: 80,
  /** Wide output budgets; truncated responses are retried with a larger budget. */
  extractionMaxTokens: 4096,
  extractionRetryMaxTokens: 8192,
  docSummaryMaxTokens: 2048,
  batchSummaryMaxTokens: 1024,
  fusionMaxTokens: 4096,
} as const;
