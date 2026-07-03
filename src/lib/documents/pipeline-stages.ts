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
  | "stageGraph"
  | "stageWiki";

export type PipelineStageStatus = "done" | "active" | "pending" | "failed";

/**
 * A single, consistent display status for a document — used by BOTH the
 * library list and the document detail page so they never disagree.
 *
 * Semantics:
 *   - "ready"      : every stage + branch complete (full pipeline done)
 *   - "enhancing"  : basic retrieval usable (linear chain done) but Graph/Wiki
 *                    branches still running — the doc is searchable NOW
 *   - "processing" : somewhere in the linear chain (convert/split/embed/index)
 *   - "failed"     : a required stage failed
 *   - "pending"    : uploaded but "Start Processing" not clicked yet
 *
 * This mirrors DocumentPipeline.isReady / isBasicReady so the list's badge and
 * the detail page's badge show the same thing.
 */
export type DocumentDisplayStatus =
  | "ready"
  | "enhancing"
  | "processing"
  | "failed"
  | "pending";

export interface PipelineStageView {
  /** i18n key under `library.detail` (e.g. "stageGraph"). */
  key: PipelineStageKey;
  status: PipelineStageStatus;
  /** 0–100 when this stage is the active one, otherwise null. */
  progress: number | null;
}

/**
 * A branch that runs IN PARALLEL with other branches after the linear
 * stages finish (Graph extraction and Wiki synthesis are submitted together
 * and complete in arbitrary order). Unlike linear stages, branches do NOT
 * enforce monotonic ordering against each other — each is independent.
 */
export interface PipelineBranchView {
  /** i18n key under `library.detail` (e.g. "stageGraph"). */
  key: PipelineStageKey;
  status: PipelineStageStatus;
  /** 0–100 when this branch is active, otherwise null. */
  progress: number | null;
}

export interface DocumentPipeline {
  /** Linear, strictly-ordered stages (Upload → Index). */
  stages: PipelineStageView[];
  /**
   * Parallel branches that fork after the linear stages. In graph mode this
   * is [Graph, Wiki]; in basic mode it's [Wiki] (no Graph). Each branch's
   * status/progress is independent of the others. Empty when there is no
   * synthesis/graph work (e.g. legacy docs).
   */
  branches: PipelineBranchView[];
  isProcessing: boolean;
  isReady: boolean;
  /**
   * True once the LINEAR chain (Upload → Index) is done, i.e. basic retrieval
   * (embedding + FTS) is usable — even if Graph/Wiki branches are still
   * running. This decouples "document is searchable" from "all enhancements
   * finished", so the UI can tell the user they can start using the doc while
   * the graph/wiki branches continue in the background.
   */
  isBasicReady: boolean;
  isFailed: boolean;
  /** 0–100 aggregate progress across all stages + branches. */
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
  wikiTask?: PipelineTaskView | null;
  graphMode: boolean;
  /** Whether wiki synthesis will/does run for this doc (gated on processing options). */
  wikiEnabled?: boolean;
}

const clampPct = (n: number | undefined | null): number =>
  Math.max(0, Math.min(100, typeof n === "number" && Number.isFinite(n) ? n : 0));

// Whether a task is still moving the doc forward (pending = about to run).
const taskActive = (t?: PipelineTaskView | null): boolean =>
  !!t && (t.status === "running" || t.status === "pending");
const taskDone = (t?: PipelineTaskView | null): boolean => !!t && t.status === "completed";
const taskFailed = (t?: PipelineTaskView | null): boolean => !!t && t.status === "failed";

/**
 * Compute a single display status from the same task inputs as the pipeline.
 * This is the SOURCE OF TRUTH for status badges so the library list and the
 * detail page can never diverge. Both call this with the same task rows.
 *
 * `doc.status` is the legacy coarse DB status; it is used only to distinguish
 * the "uploaded but not started" (pending) case and the failed case when no
 * tasks exist yet.
 */
export function computeDisplayStatus(
  pipeline: DocumentPipeline,
  docStatus: string,
): DocumentDisplayStatus {
  if (pipeline.isReady) return "ready";
  if (pipeline.isFailed) return "failed";
  if (pipeline.isBasicReady) return "enhancing";
  // Before the linear chain finishes: "pending" (not started) vs "processing".
  if (docStatus === "pending" || docStatus === "uploading") return "pending";
  return "processing";
}


export function computeDocumentPipeline({
  doc,
  convertTask,
  embedTask,
  graphTask,
  wikiTask,
  graphMode,
  wikiEnabled = true,
}: ComputeDocumentPipelineArgs): DocumentPipeline {
  // Defensive fallback: a doc with no pipeline tasks at all (e.g. processed
  // before tasks existed). Reflect documents.status best-effort so the UI
  // never shows an all-pending pipeline for an obviously-ready doc.
  if (!convertTask && !embedTask && !graphTask && !wikiTask) {
    if (doc.status === "ready") return readyPipeline(graphMode, wikiEnabled);
    if (doc.status === "failed") return failedPipeline(graphMode, wikiEnabled);
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

  // ---- Linear stages: enforce monotonic ordering (forward-only) ----
  // Graph + Wiki are NOT part of the linear chain: they run in parallel after
  // index completes, in arbitrary order, so they are computed independently
  // as branches below.
  const order: PipelineStageStatus[] = [
    uploadDone ? "done" : "active",
    convertStatus,
    splitStatus,
    embedStatus,
    indexStatus,
  ];
  const normalized = enforceMonotonic(order);

  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: normalized[0], progress: null },
    { key: "stageConvert", status: normalized[1], progress: stageProgress(normalized[1], convertTask?.progress) },
    { key: "stageSplit", status: normalized[2], progress: stageProgress(normalized[2], convertTask?.progress) },
    { key: "stageEmbed", status: normalized[3], progress: stageProgress(normalized[3], embedTask?.progress) },
    { key: "stageIndex", status: normalized[4], progress: stageProgress(normalized[4], embedTask?.progress) },
  ];

  // ---- Parallel branches: Graph + Wiki fork off after the linear stages ----
  // Each branch is independent — Graph and Wiki are submitted together and
  // complete in arbitrary order, so neither forces the other's status. A
  // branch can only be active/done once the linear chain (index) is done.
  const indexDone = normalized[4] === "done";
  const indexFailed = normalized[4] === "failed";
  const linearReachedBranches = indexDone || indexFailed;

  const branches: PipelineBranchView[] = [];

  // Wiki branch first: it completes faster (1-2 LLM calls) and putting it
  // before Graph lets users see it finish while the slow Graph extraction
  // (potentially hours) continues below.
  if (wikiEnabled) {
    let wikiStatus: PipelineStageStatus;
    if (taskFailed(wikiTask)) wikiStatus = "failed";
    else if (taskDone(wikiTask)) wikiStatus = "done";
    else if (taskActive(wikiTask)) wikiStatus = indexDone ? "active" : "pending";
    else wikiStatus = "pending";
    if (indexFailed) wikiStatus = "pending";
    branches.push({
      key: "stageWiki",
      status: wikiStatus,
      progress: stageProgress(linearReachedBranches ? wikiStatus : "pending", wikiTask?.progress),
    });
  }

  if (graphMode) {
    let graphStatus: PipelineStageStatus;
    if (taskFailed(graphTask)) graphStatus = "failed";
    else if (taskDone(graphTask)) graphStatus = "done";
    else if (taskActive(graphTask)) graphStatus = indexDone ? "active" : "pending";
    else graphStatus = "pending";
    // If the linear chain failed before reaching the branches, a branch can't
    // be active — collapse to pending.
    if (indexFailed) graphStatus = "pending";
    branches.push({
      key: "stageGraph",
      status: graphStatus,
      progress: stageProgress(linearReachedBranches ? graphStatus : "pending", graphTask?.progress),
    });
  }

  const all = [...stages, ...branches];
  const isReady = all.every((s) => s.status === "done");
  // Basic retrieval is ready once every LINEAR stage (Upload → Index) is done,
  // regardless of whether the Graph/Wiki branches have finished. Branch
  // failures don't un-ready the linear chain (a graph failure soft-lands).
  const isBasicReady = stages.every((s) => s.status === "done");
  const hasFailure = all.some((s) => s.status === "failed");
  const isProcessing = !isReady && !hasFailure;

  return {
    stages,
    branches,
    isProcessing,
    isReady,
    isBasicReady,
    isFailed: hasFailure,
    overallPercent: overallPercent(all),
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

function readyPipeline(graphMode: boolean, wikiEnabled: boolean): DocumentPipeline {
  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: "done", progress: null },
    { key: "stageConvert", status: "done", progress: null },
    { key: "stageSplit", status: "done", progress: null },
    { key: "stageEmbed", status: "done", progress: null },
    { key: "stageIndex", status: "done", progress: null },
  ];
  const branches: PipelineBranchView[] = [];
  if (graphMode) branches.push({ key: "stageGraph", status: "done", progress: null });
  if (wikiEnabled) branches.push({ key: "stageWiki", status: "done", progress: null });
  return { stages, branches, isProcessing: false, isReady: true, isBasicReady: true, isFailed: false, overallPercent: 100, graphMode };
}

function failedPipeline(graphMode: boolean, wikiEnabled: boolean): DocumentPipeline {
  const stages: PipelineStageView[] = [
    { key: "stageUpload", status: "done", progress: null },
    { key: "stageConvert", status: "failed", progress: null },
    { key: "stageSplit", status: "pending", progress: null },
    { key: "stageEmbed", status: "pending", progress: null },
    { key: "stageIndex", status: "pending", progress: null },
  ];
  const branches: PipelineBranchView[] = [];
  if (graphMode) branches.push({ key: "stageGraph", status: "pending", progress: null });
  if (wikiEnabled) branches.push({ key: "stageWiki", status: "pending", progress: null });
  return { stages, branches, isProcessing: false, isReady: false, isBasicReady: false, isFailed: true, overallPercent: 0, graphMode };
}
