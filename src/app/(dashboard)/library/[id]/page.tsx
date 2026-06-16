"use client";

import { useState, useEffect, use, Fragment } from "react";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";
import { ChunksPanel } from "@/components/library/chunks-panel";
import type { DocumentMeta } from "@/types/documents";
import { useLocale } from "@/lib/i18n";

type Tab = "overview" | "chunks";

const PIPELINE_STAGES = ["uploading", "queued", "converting", "splitting", "embedding", "indexing"] as const;

function formatBadgeColor(fmt: string): string {
  switch (fmt) {
    case "pdf": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
    case "docx": case "doc": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "pptx": case "ppt": return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
    case "xlsx": case "xls": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, format, locale } = useLocale();
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
    const isProcessing = (PIPELINE_STAGES as readonly string[]).includes(doc.status);
    if (!isProcessing) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/v1/library/documents/${id}`);
      const data = await res.json();
      if (data.success) setDoc(data.data);
    }, 4000);
    return () => clearInterval(interval);
  }, [id, doc?.status]);

  if (loading) return <div><Header title={t.common.states.loading} /><LoadingState /></div>;
  if (!doc) return <div><Header title={t.errors.notFound} /><div className="p-8">{t.errors.documentNotFound}</div></div>;

  const chunks = doc.chunks || [];
  const isZh = locale === "zh-CN";
  const isProcessing = (PIPELINE_STAGES as readonly string[]).includes(doc.status);

  const totalTokens = chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "overview", label: isZh ? "概览" : "Overview" },
    { key: "chunks", label: isZh ? "检索切片" : "Retrieval Chunks" },
  ];

  const td = t.library.detail;

  return (
    <div>
      <Header title={doc.originalName} />
      <div className="p-6 md:p-8 space-y-8">
        {isProcessing && (
          <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/30 rounded-xl p-4 flex items-center gap-3">
            <svg className="animate-spin w-5 h-5 text-orange-600 dark:text-orange-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{t.common.states.processing} — {doc.status}</span>
          </div>
        )}

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
            isZh={isZh}
            td={td}
            format={format}
            onSwitchTab={setActiveTab}
          />
        )}

        {activeTab === "chunks" && (
          <ChunksPanel chunks={chunks} docId={doc.id} isZh={isZh} format={format} />
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
  isZh: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td: any;
  format: { number: (v: number) => string; fileSize: (v: number) => string; relativeTime: (d: Date | string) => string };
  onSwitchTab: (tab: Tab) => void;
}

function lineColor(from: Stage, to: Stage, accent?: "emerald" | "violet"): string {
  if (from === "done" && (to === "done" || to === "active")) {
    return accent === "violet" ? "bg-violet-300 dark:bg-violet-700" : "bg-emerald-300 dark:bg-emerald-700";
  }
  return "bg-border";
}

type Stage = "done" | "active" | "pending" | "failed";

function StageSpacer() {
  return (
    <div className="invisible flex flex-col items-center">
      <div className="w-5 h-5 rounded-full" />
      <span className="text-[11px]">.</span>
    </div>
  );
}

interface PipelineProps {
  doc: DocumentMeta;
  stageKeys: string[];
  stageStatus: (idx: number) => Stage;
  td: Record<string, string>;
}

function Pipeline({ doc, stageKeys, stageStatus: getStageStatus, td }: PipelineProps) {
  const splitDone = ["converting", "splitting", "embedding", "indexing", "ready"].includes(doc.status);
  const isReady = doc.status === "ready";

  const allStages = [
    { key: "s0", label: stageKeys[0], status: getStageStatus(0) },
    { key: "s1", label: stageKeys[1], status: getStageStatus(1) },
    { key: "s2", label: stageKeys[2], status: getStageStatus(2) },
    { key: "s3", label: stageKeys[3], status: getStageStatus(3) },
    { key: "s4", label: stageKeys[4], status: getStageStatus(4) },
  ];

  const lineColorFor = (from: Stage, to: Stage): string => {
    if (from === "done" && (to === "done" || to === "active")) return "bg-emerald-300 dark:bg-emerald-700";
    return "bg-border";
  };

  return (
    <div className="bg-card border rounded-2xl p-6">
      <h3 className="text-sm font-semibold text-foreground mb-6">{td.processingPipeline}</h3>

      <div className="flex items-start gap-0 flex-wrap justify-center">
        {allStages.map((stage, idx) => (
          <Fragment key={stage.key}>
            <div className="flex flex-col items-center shrink-0">
              <PipelineDot status={stage.status} />
              <span className={`mt-2 text-[11px] font-medium whitespace-nowrap ${stageColor(stage.status)}`}>{stage.label}</span>
            </div>
            {idx < allStages.length - 1 && (
              <div className={`w-[120px] h-[2px] mt-[10px] rounded-full transition-colors ${lineColorFor(stage.status, allStages[idx + 1].status)}`} />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function stageColor(status: Stage): string {
  if (status === "done") return "text-emerald-600 dark:text-emerald-400";
  if (status === "active") return "text-orange-600 dark:text-orange-400";
  if (status === "failed") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function OverviewTab({ doc, chunks: chunksRaw, totalTokens, isZh, td, format, onSwitchTab }: OverviewTabProps) {
  const chunks = chunksRaw ?? [];
  const currentStageIdx = (PIPELINE_STAGES as readonly string[]).indexOf(doc.status);
  const isReady = doc.status === "ready";
  const isFailed = doc.status === "failed";

  function stageStatus(idx: number): "done" | "active" | "pending" | "failed" {
    if (isReady) return "done";
    if (isFailed) return idx < currentStageIdx ? "done" : idx === currentStageIdx ? "failed" : "pending";
    if (currentStageIdx < 0) return "pending";
    if (idx < currentStageIdx) return "done";
    if (idx === currentStageIdx) return "active";
    return "pending";
  }

  const stageKeys = [td.stageUpload, td.stageConvert, td.stageSplit, td.stageEmbed, td.stageIndex];

  return (
    <div className="space-y-8">
      <Pipeline
        doc={doc}
        stageKeys={stageKeys}
        stageStatus={stageStatus}
        td={td}
      />

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
          <DetailField label={isZh ? "格式" : "Format"} value={doc.originalFormat.toUpperCase()} />
          <DetailField label={isZh ? "大小" : "Size"} value={format.fileSize(doc.originalSize)} />
          <DetailField
            label={isZh ? "\u72b6\u6001" : "Status"}
            value={doc.status === "ready" ? (isZh ? "\u5c31\u7eea" : "Ready") : doc.status === "failed" ? (isZh ? "\u5931\u8d25" : "Failed") : doc.status}
            tone={doc.status === "ready" ? "success" : doc.status === "failed" ? "danger" : "warning"}
          />
          <DetailField label={isZh ? "\u4e0a\u4f20\u65f6\u95f4" : "Uploaded"} value={format.relativeTime(doc.createdAt)} />
          {doc.wordCount != null && <DetailField label={td.words} value={format.number(doc.wordCount)} />}
          {doc.tokenEstimate != null && <DetailField label={td.tokens} value={format.number(doc.tokenEstimate)} />}
          {chunks.length > 0 && <DetailField label={td.chunks} value={String(chunks.length)} />}
          {totalTokens > 0 && <DetailField label={`Tokens (${td.chunks.toLowerCase()})`} value={format.number(totalTokens)} />}
          {doc.conversionMethod && <DetailField label={td.conversionMethod} value={doc.conversionMethod} />}
          {doc.originalHash && <DetailField label="SHA-256" value={doc.originalHash.slice(0, 16) + "…"} />}
        </dl>
      </div>
    </div>
  );
}

/* ================================================================
 * Sub-components
 * ================================================================ */

function StatusBadge({ status, isZh }: { status: string; isZh: boolean }) {
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
      {isReady ? (isZh ? "就绪" : "Ready")
       : isFailed ? (isZh ? "失败" : "Failed")
       : (isZh ? "处理中" : "Processing")}
    </span>
  );
}

function PipelineDot({ status }: { status: "done" | "active" | "pending" | "failed" }) {
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
      status === "done" ? "bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-800"
      : status === "active" ? "bg-orange-500 dark:bg-orange-400 ring-2 ring-orange-200 dark:ring-orange-800 animate-pulse"
      : status === "failed" ? "bg-red-500 dark:bg-red-400 ring-2 ring-red-200 dark:ring-red-800"
      : "bg-border"
    }`}>
      {status === "done" && (
        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
      {status === "failed" && (
        <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      )}
    </div>
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
