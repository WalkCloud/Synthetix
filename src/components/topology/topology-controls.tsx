"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GraphViewMode } from "@/types/topology";

interface TopologyControlsProps {
  readonly drafts: readonly { id: string; title: string }[];
  readonly selectedDraftId: string | null;
  readonly onDraftChange: (id: string) => void;
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomFit: () => void;
  readonly graphMode: GraphViewMode;
  readonly onGraphModeChange: (mode: GraphViewMode) => void;
  readonly kgSearch?: string;
  readonly onKgSearchChange?: (val: string) => void;
  readonly onKgSearchSubmit?: () => void;
  readonly kgCenter?: string;
  readonly onKgCenterClear?: () => void;
  readonly totalEntities?: number;
  readonly totalRelations?: number;
  readonly leafCount?: number;
}

const VIEW_OPTIONS = [
  { value: "documents" as const, label: "Documents" },
  { value: "knowledge" as const, label: "Knowledge Graph" },
];

const BAR_H = "h-8";

export function TopologyControls({
  drafts,
  selectedDraftId,
  onDraftChange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  graphMode,
  onGraphModeChange,
  kgSearch,
  onKgSearchChange,
  onKgSearchSubmit,
  kgCenter,
  onKgCenterClear,
  totalEntities,
  totalRelations,
  leafCount,
}: TopologyControlsProps) {
  return (
    <div className="flex items-center gap-2.5 mb-4 flex-wrap h-8">
      {/* Graph view mode toggle */}
      <div className={`flex items-center bg-muted rounded-lg p-0.5 ${BAR_H}`}>
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onGraphModeChange(opt.value)}
            className={`px-3 py-1 text-[13px] font-medium rounded-md transition-colors cursor-pointer ${
              graphMode === opt.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Draft selector (documents only) */}
      {graphMode === "documents" && (
        <Select value={selectedDraftId ?? ""} onValueChange={(v) => onDraftChange(v!)}>
          <SelectTrigger size="sm" className="w-[200px] text-[13px] bg-card cursor-pointer">
            <SelectValue placeholder="Select a draft...">
              {(v: string | null) => drafts.find(d => d.id === v)?.title ?? "Select a draft..."}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {drafts.map((draft) => (
              <SelectItem key={draft.id} value={draft.id}>{draft.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Knowledge Graph search & stats */}
      {graphMode === "knowledge" && (
        <div className={`flex items-center gap-2 ${BAR_H}`}>
          <div className="relative h-full">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              value={kgSearch ?? ""}
              onChange={(e) => onKgSearchChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && kgSearch?.trim()) onKgSearchSubmit?.(); }}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Search entity..."
              className="w-[180px] h-full pl-7 pr-2 border border-border rounded-lg text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          {kgCenter && (
            <button onClick={onKgCenterClear} className="text-[12px] text-primary font-medium hover:underline whitespace-nowrap cursor-pointer">Back</button>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div className={`flex items-center gap-0.5 border border-border rounded-lg p-0.5 ${BAR_H}`}>
        <button type="button" onClick={onZoomIn} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label="Zoom in" title="Zoom in">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button type="button" onClick={onZoomOut} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label="Zoom out" title="Zoom out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button type="button" onClick={onZoomFit} className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer" aria-label="Fit to screen" title="Fit to screen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
