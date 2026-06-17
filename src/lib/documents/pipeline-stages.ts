/**
 * Task-driven Processing Pipeline computation.
 *
 * The document detail page's "Processing Pipeline" is derived from the REAL
 * async_tasks for a document (convert / embed-index / graph), NOT from the
 * coarse single-string `documents.status`. This keeps the on-screen stage
 * dots and percentages truthful to actual backend progress — including the
 * graph-extraction phase, which previously ran entirely "after" the doc was
 * already marked ready and was therefore invisible.
 *
 * This module is pure (no I/O, no i18n): it returns i18n stage *keys* that
 * the UI resolves to localized labels.
 */

export type PipelineStageKey =
  | "stageUpload"
  | "stageConvert"
  | "stageSplit"
  | "stageEmbed"
  | "stageIndex"
  | "stageGraph";

export type PipelineStageStatus = "done" | "active" | "pending" | "failed";

export interface PipelineStageView {
  /** i18n key under `library.detail` (e.g. "stageGraph"). */
  key: PipelineStageKey;
  status: PipelineStageStatus;
  /** 0–100 when this stage is the active one, otherwise null. */
  progress: number | null;
}

export interface DocumentPipeline {
  stages: PipelineStageView[];
  isProcessing: boolean;
  isReady: boolean;
  isFailed: boolean;
  /** 0–100 aggregate progress across all stages. */
  overallPercent: number;
  graphMode: boolean;
}

/** Minimal view of an async_task row needed to compute a stage. */
export interface PipelineTaskView {
  /** pending | running | completed | failed | cancelled */
  status: string;
  /** 0–100 */
  progress: number;
}

interface MinimalDoc {
  status: string;
  originalPath?: string | null;
  conversionMethod?: string | null;
}

export interface ComputeDocumentPipelineArgs {
  doc: MinimalDoc;
  convertTask?: PipelineTaskView | null;
  embedTask?: PipelineTaskView | null;
  graphTask?: PipelineTaskView | null;
  graphMode: boolean;
}

const clampPct = (n: number | undefined | null): number =>
  Math.max(0, Math.min(100, typeof n === "number" && Number.isFinite(n) ? n : 0));

// Whether a task is still moving the doc forward (pending = about to run).
const taskActive = (t?: PipelineTaskView | null): boolean =>
  !!t && (t.status === "running" || t.status === "pending");
const taskDone = (t?: PipelineTaskView | null): boolean => !!t && t.status === "completed";
const taskFailed = (t?: PipelineTaskView | null): boolean => !!t && t.status === "failed";

export function computeDocumentPipeline({
  doc,
  convertTask,
  embedTask,
  graphTask,
  graphMode,
}: ComputeDocumentPipelineArgs): DocumentPipeline {
  // Defensive fallback: a doc with no pipeline tasks at all (e.g. processed
  // before tasks existed). Reflect documents.status best-effort so the UI
  // never shows an all-pending pipeline for an obviously-ready doc.
  if (!convertTask && !embedTask && !graphTask) {
    if (doc.status === "ready") return readyPipeline(graphMode);
    if (doc.status === "failed") return failedPipeline(graphMode);
  }

  const uploadDone = !!doc.originalPath;
  const convertConverted = !!doc.conversionMethod; // set by phase1 after Docling, before split

  // ---- Convert + Split (both live inside the single document_convert task) ----
  let convertStatus: PipelineStageStatus;
  let splitStatus: PipelineStageStatus;
  if (taskFailed(convertTask)) {
    convertStatus = "failed";
    splitStatus = "failed";
  } else if (taskDone(convertTask)) {
    convertStatus = "done";
    splitStatus = "done";
  } else if (taskActive(convertTask)) {
    // convert sub-step done once Docling has run (conversionMethod set);
    // from there the same task is splitting.
    convertStatus = convertConverted ? "done" : "active";
    splitStatus = convertConverted ? "active" : "pending";
  } else {
    convertStatus = "pending";
    splitStatus = "pending";
  }

  // ---- Embed + Index (both inside the single rag_embed_index task) ----
  // rag_embed-index-worker: progress 40 = embedding started, 70 = embed done /
  // basic indexing started. So <70 => embed phase, >=70 => index phase.
  const embedProgress = embedTask?.progress ?? 0;
  let embedStatus: PipelineStageStatus;
  let indexStatus: PipelineStageStatus;
  if (taskFailed(embedTask)) {
    embedStatus = "failed";
    indexStatus = "failed";
  } else if (taskDone(embedTask)) {
    embedStatus = "done";
    indexStatus = "done";
  } else if (taskActive(embedTask)) {
    if (embedProgress >= 70) {
      embedStatus = "done";
      indexStatus = "active";
    } else {
      embedStatus = "active";
      indexStatus = "pending";
    }
  } else {
    embedStatus = "pending";
    indexStatus = "pending";
  }

  // ---- Graph (optional, rag_index task) ----
  let graphStatus: PipelineStageStatus = "pending";
  if (taskFailed(graphTask)) graphStatus = "failed";
  else if (taskDone(graphTask)) graphStatus = "done";
  else if (taskActive(graphTask)) graphStatus = "active";
  // else pending (incl. graphTask undefined: not submitted/claimed yet)

  // Enforce monotonic ordering: a stage cannot be done/active if a required
  // predecessor hasn't finished. This collapses impossible "skip-ahead"
  // states (e.g. embed active while convert still pending due to a stale
  // task row) into a consistent forward-only progression.
  const order: PipelineStageStatus[] = [
    uploadDone ? "done" : "active",
    convertStatus,
    splitStatus,
    embedStatus,
    indexStatus,
    ...(graphMode ? [graphStatus] : []),
  ];
  const normalized = enforceMonotonic(order);

  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: normalized[0], progress: null },
    { key: "stageConvert", status: normalized[1], progress: stageProgress(normalized[1], convertTask?.progress) },
    { key: "stageSplit", status: normalized[2], progress: stageProgress(normalized[2], convertTask?.progress) },
    { key: "stageEmbed", status: normalized[3], progress: stageProgress(normalized[3], embedTask?.progress) },
    { key: "stageIndex", status: normalized[4], progress: stageProgress(normalized[4], embedTask?.progress) },
  ];
  if (graphMode) {
    stages.push({
      key: "stageGraph",
      status: normalized[5],
      progress: stageProgress(normalized[5], graphTask?.progress),
    });
  }

  const isReady = stages.every((s) => s.status === "done");
  const hasFailure = stages.some((s) => s.status === "failed");
  const isProcessing = !isReady && !hasFailure;

  return {
    stages,
    isProcessing,
    isReady,
    isFailed: hasFailure,
    overallPercent: overallPercent(stages),
    graphMode,
  };
}

/** Progress is only meaningful for the stage currently doing work. */
function stageProgress(status: PipelineStageStatus, raw?: number): number | null {
  return status === "active" ? clampPct(raw) : null;
}

/**
 * Collapse impossible "skip-ahead" orderings into a forward-only progression:
 * once a stage is pending, no later stage may be done/active; an active stage
 * forces all earlier stages to done. The first failed stage stops the line.
 */
function enforceMonotonic(statuses: PipelineStageStatus[]): PipelineStageStatus[] {
  const out: PipelineStageStatus[] = [];
  let seenPending = false;
  for (const s of statuses) {
    if (seenPending) {
      out.push("pending");
      continue;
    }
    if (s === "active") {
      // everything before is implicitly done
      for (let i = 0; i < out.length; i++) if (out[i] === "pending") out[i] = "done";
      out.push("active");
    } else if (s === "pending") {
      seenPending = true;
      out.push("pending");
    } else {
      out.push(s); // done | failed
    }
  }
  return out;
}

function overallPercent(stages: PipelineStageView[]): number {
  const doneCount = stages.filter((s) => s.status === "done").length;
  const active = stages.find((s) => s.status === "active");
  const activeFrac = active && active.progress != null ? active.progress / 100 : 0;
  if (stages.every((s) => s.status === "done")) return 100;
  return Math.round(((doneCount + activeFrac) / stages.length) * 100);
}

function readyPipeline(graphMode: boolean): DocumentPipeline {
  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: "done", progress: null },
    { key: "stageConvert", status: "done", progress: null },
    { key: "stageSplit", status: "done", progress: null },
    { key: "stageEmbed", status: "done", progress: null },
    { key: "stageIndex", status: "done", progress: null },
  ];
  if (graphMode) stages.push({ key: "stageGraph", status: "done", progress: null });
  return { stages, isProcessing: false, isReady: true, isFailed: false, overallPercent: 100, graphMode };
}

function failedPipeline(graphMode: boolean): DocumentPipeline {
  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: "done", progress: null },
    { key: "stageConvert", status: "failed", progress: null },
    { key: "stageSplit", status: "pending", progress: null },
    { key: "stageEmbed", status: "pending", progress: null },
    { key: "stageIndex", status: "pending", progress: null },
  ];
  if (graphMode) stages.push({ key: "stageGraph", status: "pending", progress: null });
  return { stages, isProcessing: false, isReady: false, isFailed: true, overallPercent: 0, graphMode };
}
