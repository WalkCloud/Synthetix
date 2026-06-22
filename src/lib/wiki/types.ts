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

/** Thresholds + tunables for the synthesis pipeline. */
export const WIKI_CONFIG = {
  /** Max tokens of a single chunk fed to the LLM in Phase A. */
  chunkMaxTokens: 2000,
  /** Max tokens of existing Wiki titles list included in the Phase A prompt. */
  titlesListMaxTokens: 400,
  /** Char limit for a single entry's content (keeps entries modular/small). */
  entryContentCharLimit: 800,
  /** Min title similarity (Jaccard on tokens) to consider two entries the same. */
  duplicateTitleThreshold: 0.45,
  /** How many chunks' micro-summaries can be combined before Phase B batches them. */
  docSummaryBatchChars: 6000,
} as const;
