"use client";

import type { TopologyNode } from "@/types/topology";
import { useLocale } from "@/lib/i18n";

interface TopologyDetailPanelProps {
  readonly node: TopologyNode;
  readonly loading?: boolean;
  readonly onNavigate?: (label: string) => void;
  readonly onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  technology: "#2563EB", concept: "#7C3AED", organization: "#EA580C",
  person: "#16A34A", location: "#0891B2", event: "#D97706",
  method: "#9333EA", framework: "#2563EB", tool: "#059669",
};

function typeColor(t: string) {
  return TYPE_COLORS[t.toLowerCase()] ?? "#7C3AED";
}

export function TopologyDetailPanel({
  node,
  loading,
  onNavigate,
  onClose,
}: TopologyDetailPanelProps) {
  const { t, format } = useLocale();
  const isDraft = node.type === "draft";
  const totalSections = node.totalSections ?? 0;
  const completedSections = node.completedSections ?? 0;
  const sectionsWithReferences = node.sectionsWithReferences ?? 0;
  const totalReferences = node.totalReferences ?? node.referenceCount ?? 0;
  const uniqueDocuments = node.uniqueDocuments ?? 0;
  const coveragePercent = totalSections > 0 ? Math.round((sectionsWithReferences / totalSections) * 100) : 0;
  const etype = isDraft ? t.topology.detailPanel.mainDocType : node.entityType || "entity";
  const tc = typeColor(etype);
  const hasDescription = !!node.description;
  const d = t.topology.detailPanel;
  const draftStatusLabel = (status?: string) => {
    if (status === "completed") return d.docStatusCompleted;
    if (status === "modifying") return d.docStatusModifying;
    return d.docStatusDrafting;
  };
  const coverageInsight = () => {
    if (totalSections === 0) return d.coverageNoSections;
    if (coveragePercent >= 75) return d.coverageHigh;
    if (coveragePercent >= 40) return d.coverageMid;
    return d.coverageLow;
  };
  const nextStep = () => {
    if (completedSections < totalSections) return d.nextStepContinue;
    if (coveragePercent < 40) return d.nextStepCoverage;
    return d.nextStepReview;
  };

  return (
    <div className="absolute right-4 top-4 z-30 w-[280px] max-h-[calc(100%-16px)] bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-[12px] font-semibold text-foreground">{d.details}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground break-all flex-1">{node.label}</span>
          <span className="shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium" style={{ color: tc, backgroundColor: `${tc}15` }}>{etype}</span>
        </div>

        {node.type === "reference" && (
          <div className="text-[10px] text-muted-foreground">
            {format.template(
              node.referenceCount !== 1 ? d.refCountPlural : d.refCount,
              { count: node.referenceCount, percent: Math.round(node.relevanceScore * 100) },
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-1">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-muted-foreground">{d.loadingDetails}</span>
          </div>
        )}

        {isDraft && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground block mb-1">{d.documentStatus}</span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">{draftStatusLabel(node.draftStatus)}</span>
                <span className="rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">{coveragePercent}% {d.covered}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{d.sections}</span>
                <span className="text-[13px] font-semibold text-foreground">{completedSections}/{totalSections}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{d.coverage}</span>
                <span className="text-[13px] font-semibold text-foreground">{sectionsWithReferences}/{totalSections}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{d.references}</span>
                <span className="text-[13px] font-semibold text-foreground">{totalReferences}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{d.sources}</span>
                <span className="text-[13px] font-semibold text-foreground">{uniqueDocuments}</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground block mb-1">{d.coverageInsight}</span>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{coverageInsight()}</p>
              {node.mostReferencedDoc && (
                <p className="mt-1.5 text-[10px] text-muted-foreground break-all">{d.mostReferenced}: {node.mostReferencedDoc}</p>
              )}
            </div>

            <div className="rounded-lg bg-primary/5 px-2.5 py-2">
              <span className="text-[11px] text-primary font-semibold block mb-1">{d.nextStep}</span>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{nextStep()}</p>
            </div>

            <a
              href={`/writing/${node.id}`}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/5 transition-colors cursor-pointer"
            >
              {d.openWritingPage}
            </a>
          </div>
        )}

        {hasDescription && (
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">{d.description}</span>
            <p className="text-[11px] text-foreground/80 leading-relaxed">{node.description}</p>
          </div>
        )}

        {node.referenceChunks && node.referenceChunks.length > 0 && (
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1.5">
              {d.referenceSources} ({node.referenceChunks.length})
            </span>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {node.referenceChunks.map((chunk, i) => (
                <div key={i} className="rounded-lg bg-secondary/50 px-2.5 py-1.5">
                  {chunk.sourceAnchor && (
                    <p className="text-[11px] text-foreground font-medium break-all">{chunk.sourceAnchor}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground break-all flex-1">{chunk.sectionTitle}</span>
                    <span className="text-[10px] text-primary font-semibold shrink-0">{Math.round(chunk.relevanceScore * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isDraft && !hasDescription && !node.referenceChunks?.length && !loading && (
          <p className="text-[11px] text-muted-foreground italic">{d.noMoreInfo}</p>
        )}

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate(node.label)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {d.viewInGraph}
          </button>
        )}
      </div>
    </div>
  );
}
