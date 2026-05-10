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
  readonly refFilter: string;
  readonly onRefFilterChange: (value: string) => void;
  readonly groupBy: string;
  readonly onGroupByChange: (value: string) => void;
  readonly graphMode: GraphViewMode;
  readonly onGraphModeChange: (mode: GraphViewMode) => void;
}

const REF_FILTER_OPTIONS = [
  { value: "all", label: "All References" },
  { value: "direct", label: "Direct References" },
  { value: "indirect", label: "Indirect References" },
] as const;

const GROUP_BY_OPTIONS = [
  { value: "document", label: "By document" },
  { value: "section", label: "By section" },
  { value: "anchor", label: "By citation anchor" },
] as const;

const VIEW_OPTIONS = [
  { value: "documents" as const, label: "Documents" },
  { value: "knowledge" as const, label: "Knowledge Graph" },
];


const ICON_BUTTON_CLASSES =
  "flex items-center justify-center w-9 h-9 rounded-lg text-[#52525B] hover:bg-[#F5F5F3] hover:text-[#18181B] transition-colors cursor-pointer";

export function TopologyControls({
  drafts,
  selectedDraftId,
  onDraftChange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  refFilter,
  onRefFilterChange,
  groupBy,
  onGroupByChange,
  graphMode,
  onGraphModeChange,
}: TopologyControlsProps) {
  return (
    <div className="flex items-center gap-2.5 mb-4 flex-wrap">
      {/* Graph view mode toggle */}
      <div className="flex items-center bg-[#F5F5F3] rounded-lg p-0.5">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onGraphModeChange(opt.value)}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer ${
              graphMode === opt.value
                ? "bg-white text-[#18181B] shadow-sm"
                : "text-[#A1A1AA] hover:text-[#52525B]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Draft selector (documents mode only) */}
      {graphMode === "documents" && (
        <Select value={selectedDraftId ?? ""} onValueChange={(v) => onDraftChange(v!)}>
          <SelectTrigger className="w-[150px] text-[13px] bg-white cursor-pointer">
            <SelectValue placeholder="Select a draft..."></SelectValue>
          </SelectTrigger>
          <SelectContent>
            {drafts.map((draft) => (
              <SelectItem key={draft.id} value={draft.id}>
                {draft.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Zoom controls */}
      <div className="flex items-center gap-1 border border-[#E4E4E7] rounded-lg p-0.5">
        <button
          type="button"
          onClick={onZoomIn}
          className={ICON_BUTTON_CLASSES}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onZoomOut}
          className={ICON_BUTTON_CLASSES}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onZoomFit}
          className={ICON_BUTTON_CLASSES}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>

      {graphMode === "documents" && (
        <>
          {/* Reference filter */}
          <Select value={refFilter} onValueChange={(v) => onRefFilterChange(v!)}>
            <SelectTrigger className="w-[150px] text-[13px] bg-white cursor-pointer">
              <SelectValue>{(v: string | null) => REF_FILTER_OPTIONS.find(o => o.value === v)?.label ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REF_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Group by */}
          <Select value={groupBy} onValueChange={(v) => onGroupByChange(v!)}>
            <SelectTrigger className="w-[150px] text-[13px] bg-white cursor-pointer">
              <SelectValue>{(v: string | null) => GROUP_BY_OPTIONS.find(o => o.value === v)?.label ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}
