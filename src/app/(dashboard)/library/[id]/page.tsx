"use client";

import { useState, useEffect, use, Fragment, useMemo } from "react";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";
import { ChunksPanel } from "@/components/library/chunks-panel";
import { WikiPrecipField } from "@/components/library/wiki-precip-card";
import type { DocumentMeta } from "@/types/documents";
import { useLocale } from "@/lib/i18n";
import type { DocumentPipeline, PipelineStageKey, PipelineStageStatus } from "@/lib/documents/pipeline-stages";

type Tab = "overview" | "chunks";

function formatBadgeColor(fmt: string): string {
  switch (fmt) {
    case "pdf": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    case "docx": case "doc": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "pptx": case "ppt": return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, format } = useLocale();
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/v1/library/documents/${id}`);
      const data = await res.json();
      if (data.success) {
        setDoc(data.data);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    // Drive polling off the REAL pipeline (task-driven) so it keeps
    // refreshing through the graph-extraction phase — which runs AFTER the
    // document would otherwise look "ready" when read from status alone.
    if (!doc.pipeline?.isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/library/documents/${id}`);
        const data = await res.json();
        if (data.success) setDoc(data.data);
      } catch {
        // Transient fetch failure (dev recompilation, network blip). The
        // polling interval will retry on the next tick.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [id, doc?.pipeline?.isProcessing]);

  if (loading) return <div><Header title={t.common.states.loading} /><LoadingState /></div>;
  if (!doc) return <div><Header title={t.errors.notFound} /><div className="p-8">{t.errors.documentNotFound}</div></div>;

  const chunks = doc.chunks || [];
  const td = t.library.detail;

  const totalTokens = chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "overview", label: td.overview },
    { key: "chunks", label: td.chunks },
  ];

  return (
    <div>
      <Header title={doc.originalName} />
      <div className="p-6 md:p-8 space-y-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 ${
                activeTab === tab.key
                  ? "text-primary border-primary font-semibold"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.badge && (
                <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                  activeTab === tab.key
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-muted text-muted-foreground"
                }`}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <OverviewTab
            doc={doc}
            chunks={chunks}
            totalTokens={totalTokens}
            td={td}
            format={format}
            onSwitchTab={setActiveTab}
          />
        )}

        {activeTab === "chunks" && (
          <ChunksPanel chunks={chunks} docId={doc.id} format={format} />
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * Overview Tab
 * ================================================================ */

interface OverviewTabProps {
  doc: DocumentMeta;
  chunks: DocumentMeta["chunks"];
  totalTokens: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td: any;
  format: { number: (v: number) => string; fileSize: (v: number) => string; relativeTime: (d: Date | string) => string };
  onSwitchTab: (tab: Tab) => void;
}

interface PipelineProps {
  pipeline: DocumentPipeline;
  td: Record<string, string>;
}

/**
 * Per-stage line icons (stroke, 24px grid). Rendered inside the node tile
 * unless the stage is done (then a checkmark takes over).
 */
const STAGE_ICONS: Record<PipelineStageKey, React.ReactElement> = {
  stageUpload: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  stageConvert: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  ),
  stageSplit: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="21" /><line x1="6" y1="9" x2="18" y2="9" /><line x1="6" y1="15" x2="18" y2="15" />
    </svg>
  ),
  stageEmbed: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  ),
  stageIndex: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  stageGraph: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><line x1="6.5" y1="7" x2="11" y2="16" /><line x1="17.5" y1="7" x2="13" y2="16" /><line x1="7" y1="6" x2="17" y2="6" />
    </svg>
  ),
  stageWiki: (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
};

/**
 * Processing Pipeline — a flowing-track design.
 *
 * Design principles (per user feedback):
 *   1. NO percentages. A frozen percentage reads as "stuck" even while work
 *      continues (LLM calls vary wildly in duration). Instead, an active
 *      stage shows a perpetual flowing animation — "if it's moving, it's
 *      alive".
 *   2. One continuous track conveys progression without implying precise
 *      completion. Done segments fill solid; the active segment carries a
 *      flowing sheen; future segments stay muted.
 *   3. Graph + Wiki sit side-by-side at the end (not a forked circuit). They
 *      run in parallel, so showing them as peers at the same height is both
 *      truthful and visually calm.
 */
function Pipeline({ pipeline, td }: PipelineProps) {
  const { t } = useLocale();
  const linear = pipeline.stages;
  const branches = pipeline.branches;
  // The full ordered list of nodes to render on the track: linear stages,
  // then each parallel branch as its own node. Branches are peers (same
  // height), rendered after the last linear stage.
  const nodes: { key: string; status: PipelineStageStatus; isBranch: boolean }[] = [
    ...linear.map((s) => ({ key: s.key, status: s.status, isBranch: false })),
    ...branches.map((b) => ({ key: b.key, status: b.status, isBranch: true })),
  ];

  return (
    <div className="bg-card border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-semibold text-foreground">{td.processingPipeline}</h3>
        <PipelineStatusBadge pipeline={pipeline} />
      </div>

      {/* Nodes row. Each node = icon tile + label. Connectors are drawn
          between siblings as flowing segments. */}
      <div className="flex items-start justify-center gap-0 flex-wrap">
        {nodes.map((node, idx) => (
          <Fragment key={node.key}>
            <PipelineNode nodeKey={node.key as PipelineStageKey} status={node.status} label={td[node.key as PipelineStageKey] ?? node.key} />
            {idx < nodes.length - 1 && (
              <PipelineSegment
                from={nodes[idx].status}
                to={nodes[idx + 1].status}
              />
            )}
          </Fragment>
        ))}
      </div>

      {/* Foot summary: a calm, percentage-free status line. */}
      <PipelineFoot pipeline={pipeline} td={td} />
    </div>
  );
}

/** Top-right status badge (processing / ready / failed). */
function PipelineStatusBadge({ pipeline }: { pipeline: DocumentPipeline }) {
  const { t } = useLocale();
  if (pipeline.isReady) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
        {t.common.states.ready}
      </span>
    );
  }
  // Basic retrieval is usable even while Graph/Wiki branches are still running.
  // Show a distinct "Ready · enhancing" badge instead of generic "Processing".
  if (pipeline.isBasicReady) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 animate-ping-slow" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-500" />
        </span>
        {t.common.states.enhancing}
      </span>
    );
  }
  if (pipeline.isFailed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M6 18L18 6" /></svg>
        {t.common.states.failed}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 animate-ping-slow" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
      </span>
      {t.common.states.processing}
    </span>
  );
}

/** A stage icon tile (Ø36) with status styling + an active pulse ring. */
function PipelineNode({ nodeKey, status, label }: { nodeKey: PipelineStageKey; status: PipelineStageStatus; label: string }) {
  const icon = STAGE_ICONS[nodeKey];
  const isDone = status === "done";
  const isActive = status === "active";
  const isFailed = status === "failed";

  return (
    <div className="flex flex-col items-center shrink-0 w-[68px]">
      <div className="relative flex items-center justify-center">
        {/* Active pulse ring — a soft expanding halo. Replaces the old
            three-dot bounce; reads as "this is the live one". */}
        {isActive && (
          <span className="absolute inline-flex h-9 w-9 rounded-xl bg-orange-400/30 animate-ping-slow" aria-hidden />
        )}
        <div
          className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
            isDone
              ? "bg-emerald-500 text-white dark:bg-emerald-500"
              : isActive
              ? "bg-orange-500 text-white dark:bg-orange-500 shadow-[0_0_0_4px_rgba(249,115,22,0.15)]"
              : isFailed
              ? "bg-red-500 text-white"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isDone ? (
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
          ) : (
            icon
          )}
        </div>
      </div>
      <span className={`mt-2 text-[11px] font-medium whitespace-nowrap ${stageColor(status)}`}>
        {label}
      </span>
      {/* Active indicator: a subtle perpetual shimmer under the label,
          replacing any percentage. "Moving = alive". */}
      {isActive && (
        <span className="mt-1 h-0.5 w-7 rounded-full bg-orange-400/40 overflow-hidden">
          <span className="block h-full w-3 rounded-full bg-orange-500 animate-segment-shimmer" />
        </span>
      )}
    </div>
  );
}

/**
 * The connector between two nodes. Done→done is a solid filled segment;
          done→active carries the flowing sheen so data reads as travelling into
 * the live stage; anything touching pending is muted.
 */
function PipelineSegment({ from, to }: { from: PipelineStageStatus; to: PipelineStageStatus }) {
  const filled = from === "done";
  const flowing = from === "done" && to === "active";
  return (
    <div className={`relative w-[44px] h-[2px] mt-[17px] rounded-full overflow-hidden shrink-0 ${filled ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"}`}>
      {flowing && <div className="absolute inset-0 pipeline-flow" aria-hidden />}
    </div>
  );
}

/** Calm, percentage-free footer summarizing progress as a count of stages. */
function PipelineFoot({ pipeline, td }: { pipeline: DocumentPipeline; td: Record<string, string> }) {
  const { t } = useLocale();
  if (pipeline.isReady) {
    return (
      <div className="mt-6 pt-4 border-t border-border text-center text-xs text-muted-foreground">
        {t.library.detail.pipelineReadySummary ?? "All stages complete"}
      </div>
    );
  }
  if (pipeline.isFailed) {
    return (
      <div className="mt-6 pt-4 border-t border-border text-center text-xs text-red-600 dark:text-red-400">
        {t.library.detail.pipelineFailedSummary ?? "Processing failed — you can retry"}
      </div>
    );
  }
  const all = [...pipeline.stages, ...pipeline.branches];
  const doneCount = all.filter((s) => s.status === "done").length;
  const total = all.length;
  // Which stage(s) are active right now — name them so the user knows what's
  // happening, without a misleading percentage.
  const activeNames = all
    .filter((s) => s.status === "active")
    .map((s) => td[s.key] ?? s.key);
  const activeLabel = activeNames.length > 0 ? activeNames.join(" · ") : null;
  // When the linear chain is done but branches are still running, prefix the
  // footer with a "ready to use" hint so the user knows they don't have to wait.
  const basicReadyHint = pipeline.isBasicReady
    ? (t.library.detail.pipelineBasicReadyHint ?? "Ready to use — still enhancing:")
    : null;
  return (
    <div className="mt-6 pt-4 border-t border-border flex items-center justify-center gap-2 text-xs text-muted-foreground">
      {basicReadyHint && <span className="text-sky-600 dark:text-sky-400">{basicReadyHint}</span>}
      <span className="font-medium text-foreground">{doneCount}/{total}</span>
      <span>{t.library.detail.pipelineStagesDone ?? "stages done"}</span>
      {activeLabel && (
        <>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 animate-ping-slow" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500" />
            </span>
            {activeLabel}
          </span>
        </>
      )}
    </div>
  );
}

function stageColor(status: PipelineStageStatus): string {
  if (status === "done") return "text-emerald-600 dark:text-emerald-400";
  if (status === "active") return "text-orange-600 dark:text-orange-400";
  if (status === "failed") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function OverviewTab({ doc, chunks: chunksRaw, totalTokens, td, format, onSwitchTab }: OverviewTabProps) {
  const chunks = chunksRaw ?? [];
  const { t, format: localeFormat } = useLocale();
  // Prefer displayStatus (pipeline-derived: distinguishes "enhancing" while
  // graph/wiki branches still run from a true "ready"). Falls back to the raw
  // doc.status for legacy docs without a computed pipeline.
  const effectiveStatus = doc.displayStatus ?? doc.status;
  const statusLabel = (status: string) =>
    status === "ready" ? t.common.states.ready
    : status === "failed" ? t.common.states.failed
    : status === "enhancing" ? t.common.states.enhancing
    : status === "processing" ? t.common.states.processing
    : status === "indexing_graph" ? t.common.states.indexingGraph
    : status === "pending" ? t.common.states.pending
    : status;

  // Format processing duration (ms) → "10分30秒" / "1h 5m 20s". null/undefined
  // while still processing shows "处理中". Falls back to "—" when no data.
  const formatDuration = (ms: number | null | undefined): string => {
    if (ms == null || ms <= 0) return "—";
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return localeFormat.template(td.durationHoursMinutes, { hours: h, minutes: m });
    if (m > 0) return localeFormat.template(td.durationMinutesSeconds, { minutes: m, seconds: s });
    return localeFormat.template(td.durationSeconds, { seconds: s });
  };

  // Live elapsed timer: ticks every second while processing, based on the
  // server-provided processingStartedAt timestamp. Returns null when not
  // processing or no start time available.
  const isProcessing = effectiveStatus !== "ready" && effectiveStatus !== "pending" && effectiveStatus !== "failed" && effectiveStatus !== "enhancing";
  const liveElapsedMs = useLiveTimer(isProcessing ? doc.processingStartedAt : null);

  return (
    <div className="space-y-8">
      {doc.pipeline && <Pipeline pipeline={doc.pipeline} td={td} />}

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard
          icon={<WordsIcon />}
          label={td.words}
          value={doc.wordCount != null ? format.number(doc.wordCount) : "—"}
        />
        <MetricCard
          icon={<TokensIcon />}
          label={td.tokens}
          value={doc.tokenEstimate != null ? format.number(doc.tokenEstimate) : "—"}
        />
        <MetricCard
          icon={<GridIcon />}
          label={td.chunks}
          value={String(chunks.length)}
          accent="blue"
          subtitle={chunks.length > 0 ? `${format.number(totalTokens)} tokens` : undefined}
          onClick={() => onSwitchTab("chunks")}
        />
      </div>

      {/* Document details — always visible */}
      <div className="bg-card border rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">{td.documentDetails}</h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          <DetailField label={td.format} value={doc.originalFormat.toUpperCase()} />
          <DetailField label={td.size} value={format.fileSize(doc.originalSize)} />
          <DetailField
            label={td.status}
            value={statusLabel(effectiveStatus)}
            tone={effectiveStatus === "ready" ? "success" : effectiveStatus === "failed" ? "danger" : effectiveStatus === "pending" ? undefined : "warning"}
          />
          <DetailField label={td.uploaded} value={format.relativeTime(doc.createdAt)} />
          {doc.wordCount != null && <DetailField label={td.words} value={format.number(doc.wordCount)} />}
          {doc.tokenEstimate != null && <DetailField label={td.tokens} value={format.number(doc.tokenEstimate)} />}
          {chunks.length > 0 && <DetailField label={td.chunks} value={String(chunks.length)} />}
          {totalTokens > 0 && <DetailField label={`Tokens (${td.chunks.toLowerCase()})`} value={format.number(totalTokens)} />}
          {doc.conversionMethod && <DetailField label={td.conversionMethod} value={doc.conversionMethod} />}
          {doc.originalHash && <DetailField label="SHA-256" value={doc.originalHash.slice(0, 16) + "..."} />}
          {/* Processing Time = "time to usable" (convert → embed).
              Graph/wiki enhancement time shown separately so users understand
              the doc is already searchable while enhancement continues. */}
          {(() : React.ReactNode => {
            const isReady = effectiveStatus === "ready";
            const isEnhancing = effectiveStatus === "enhancing";
            const isProc = !isReady && !isEnhancing && effectiveStatus !== "pending" && effectiveStatus !== "failed";

            if (isReady || isEnhancing) {
              // Basic processing done — show basicDuration (time to usable).
              const basicMs = doc.basicDurationMs ?? doc.processingDurationMs;
              const enhMs = doc.enhancementDurationMs;
              return (
                <>
                  {basicMs != null && (
                    <DetailField label={td.processingTime} value={formatDuration(basicMs)} />
                  )}
                  {isEnhancing && enhMs == null && (
                    <DetailField label={td.enhancementTime} value={td.processingInProgress} tone="warning" />
                  )}
                  {enhMs != null && isReady && (
                    <DetailField label={td.enhancementTime} value={formatDuration(enhMs)} tone="success" />
                  )}
                </>
              );
            }
            if (isProc) {
              return liveElapsedMs != null ? (
                <DetailField label={td.processingTime} value={formatDuration(liveElapsedMs)} tone="warning" />
              ) : (
                <DetailField label={td.processingTime} value={td.processingInProgress} tone="warning" />
              );
            }
            return null;
          })()}

          {/* Knowledge distillation - integrated as a document property */}
          {doc.status === "ready" && <WikiPrecipField documentId={doc.id} />}
        </dl>
      </div>
    </div>
  );
}

/* ================================================================
 * Sub-components
 * ================================================================ */

/**
 * Live elapsed timer: given an ISO start timestamp, returns the elapsed
 * milliseconds since that timestamp, updating every second. Returns null
 * when startTs is null (not processing). Uses server time as the anchor
 * to stay accurate even if the client clock is off.
 */
function useLiveTimer(startTs: string | null | undefined): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startTs) {
      setElapsed(null);
      return;
    }
    const start = new Date(startTs).getTime();
    if (isNaN(start)) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(Date.now() - start);
    tick(); // immediate
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTs]);

  return elapsed;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const isReady = status === "ready";
  const isFailed = status === "failed";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg ${
      isReady ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      : isFailed ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        isReady ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-orange-500 animate-pulse"
      }`} />
      {isReady ? t.common.states.ready
       : isFailed ? t.common.states.failed
       : t.common.states.processing}
    </span>
  );
}

function MetricCard({ icon, label, value, accent, subtitle, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "violet" | "blue";
  subtitle?: string;
  onClick?: () => void;
}) {
  const isViolet = accent === "violet";
  const isBlue = accent === "blue";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border bg-card px-4 py-3.5 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md" : "cursor-default"
      } ${
        isViolet ? "border-violet-200/70 hover:border-violet-300 dark:border-violet-900/40 dark:hover:border-violet-700"
        : isBlue ? "border-blue-200/70 hover:border-blue-300 dark:border-blue-900/40 dark:hover:border-blue-700"
        : "border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isViolet ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
          : isBlue ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
          : "bg-muted text-muted-foreground"
        }`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold tabular-nums text-foreground leading-tight">{value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
        </div>
      </div>
      {subtitle && (
        <div className={`text-[10px] font-medium mt-2 pl-12 ${
          isViolet ? "text-violet-600 dark:text-violet-400"
          : isBlue ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground"
        }`}>{subtitle}</div>
      )}
    </button>
  );
}

function DetailField({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "warning" }) {
  const colorClass = tone === "success" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "danger" ? "text-red-600 dark:text-red-400"
    : tone === "warning" ? "text-orange-600 dark:text-orange-400"
    : "font-medium";
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm mt-0.5 ${colorClass}`}>{value}</dd>
    </div>
  );
}

/* ---- Inline SVG icons ---- */

function WordsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
    </svg>
  );
}

function TokensIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9z" /><path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" />
      <path d="M20 9h3" /><path d="M20 14h3" /><path d="M1 9h3" /><path d="M1 14h3" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
