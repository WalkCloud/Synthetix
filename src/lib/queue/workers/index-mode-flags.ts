import type { ProcessingOptions } from "@/lib/queue/types";

/**
 * Returns true when graph-mode entity extraction should be enqueued AFTER
 * the basic embedding/indexing pass completes. Graph extraction is the
 * most expensive stage in the pipeline (per-chunk LLM calls), so it only
 * runs when the user picked `indexMode: "graph"` AND chose to index the
 * full document (`indexTarget: "full"`).
 */
export function shouldEnqueueGraphIndex(options: Pick<ProcessingOptions, "indexMode" | "indexTarget">): boolean {
  return options.indexMode === "graph" && (options.indexTarget || "full") === "full";
}

/**
 * Returns true when Wiki synthesis should be enqueued AFTER basic index
 * (+ optional graph) completes. Wiki synthesis is the final knowledge
 * precipitation layer — it runs per-chunk (never overflows the LLM context
 * window) and defaults to enabled. Users can opt out via `wikiEnabled: false`
 * to save tokens on large bulk uploads.
 *
 * Requires full indexing (not "original" only) because Wiki synthesis reads
 * the document's chunks.
 */
export function shouldEnqueueWikiSynthesis(options: Pick<ProcessingOptions, "wikiEnabled" | "indexTarget">): boolean {
  if (options.wikiEnabled === false) return false;
  return (options.indexTarget || "full") === "full";
}
