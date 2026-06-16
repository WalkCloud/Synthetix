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
