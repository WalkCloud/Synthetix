import type { ProcessingOptions } from "@/lib/queue/types";

/**
 * Derive graphMode / wikiEnabled for a document from its stored async-task
 * rows — the SAME way everywhere (library list + document detail) so the two
 * views never disagree about which pipeline branches to show.
 *
 * Source of truth order:
 *   1. The options stored on the document_convert task (reflects the Knowledge
 *      Mode the user picked — works even before the enhancement tasks start).
 *   2. Fallback: whether the corresponding task (rag_index / wiki_synthesize)
 *      was ever enqueued (truthful even if options were lost/malformed).
 *
 * @param convertInputData  the document_convert task's inputData JSON string
 * @param hasGraphTask      true if a rag_index task row exists for this doc
 * @param hasWikiTask       true if a wiki_synthesize task row exists for this doc
 */
export function derivePipelineModes(
  convertInputData: string | null | undefined,
  hasGraphTask: boolean,
  hasWikiTask: boolean,
): { graphMode: boolean; wikiEnabled: boolean } {
  let graphMode = false;
  let wikiEnabled = false;
  if (convertInputData) {
    try {
      const parsed = JSON.parse(convertInputData) as { options?: ProcessingOptions };
      if (parsed.options) {
        graphMode = shouldEnqueueGraphIndex(parsed.options);
        wikiEnabled = shouldEnqueueWikiSynthesis(parsed.options);
      }
    } catch {
      /* malformed input — ignore, fall back to task presence */
    }
  }
  // Task presence is a truthful backstop (e.g. options lost or a recovery run).
  return { graphMode: graphMode || hasGraphTask, wikiEnabled: wikiEnabled || hasWikiTask };
}

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
