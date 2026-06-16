export const docStatusLabels: Record<string, string> = {
  uploading: "Uploading",
  queued: "Queued",
  converting: "Converting",
  splitting: "Splitting",
  embedding: "Embedding",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

export const docStatusColors: Record<string, string> = {
  uploading: "bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
  queued: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  converting: "bg-orange-100 text-amber-700 dark:bg-orange-950/35 dark:text-amber-300",
  splitting: "bg-orange-100 text-amber-700 dark:bg-orange-950/35 dark:text-amber-300",
  embedding: "bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
  indexing: "bg-orange-100 text-amber-700 dark:bg-orange-950/35 dark:text-amber-300",
  ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/35 dark:text-red-300",
};

export const draftStatusLabels: Record<string, string> = {
  drafting: "In Progress",
  modifying: "Revising",
  completed: "Completed",
};

export const draftStatusColors: Record<string, string> = {
  drafting: "bg-orange-50 text-orange-600 dark:bg-orange-950/35 dark:text-orange-300",
  modifying: "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
  completed: "bg-green-50 text-green-600 dark:bg-green-950/35 dark:text-green-300",
};
