import type { TranslationSchema } from "./types";

type CommonStates = TranslationSchema["common"]["states"];

export function getDocumentStatusLabel(status: string, states: CommonStates): string {
  const labels: Record<string, string> = {
    ready: states.ready,
    failed: states.failed,
    enhancing: states.enhancing,
    processing: states.processing,
    indexing_graph: states.indexingGraph,
    pending: states.pending,
    completed: states.completed,
    cancelled: states.cancelled,
  };
  return labels[status] ?? states.unknown;
}
