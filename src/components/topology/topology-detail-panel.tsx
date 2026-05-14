"use client";

import type { TopologyNode, TopologyEdge } from "@/types/topology";

interface TopologyDetailPanelProps {
  readonly node: TopologyNode;
  readonly edge: TopologyEdge | null;
  readonly onClose: () => void;
}

const COLORS: Record<string, string> = {
  pdf: "#2563EB", docx: "#EA580C", md: "#16A34A", markdown: "#16A34A",
  draft: "#7C3AED", entity: "#7C3AED",
};
const BGS: Record<string, string> = {
  pdf: "#EFF6FF", docx: "#FFF7ED", md: "#F0FDF4", markdown: "#F0FDF4",
  draft: "#F3F1FC", entity: "#F5F3FF",
};

function formatRelevance(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function TopologyDetailPanel({
  node,
  edge,
  onClose,
}: TopologyDetailPanelProps) {
  const color = COLORS[node.format.toLowerCase()] ?? "#7C3AED";
  const bgColor = BGS[node.format.toLowerCase()] ?? "#F3F1FC";
  const fmtLabel = node.format.toUpperCase();

  return (
    <div className="absolute right-4 top-4 z-30 w-[260px] max-h-[calc(100%-32px)] bg-white/95 backdrop-blur-sm border border-[#E8E6E1] rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F0EEEB] shrink-0">
        <span className="text-[12px] font-semibold text-[#1E1B18]">Details</span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded-md text-[#8C887F] hover:text-[#1E1B18] hover:bg-[#F4F2EF] transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="px-4 py-3 space-y-2.5 overflow-y-auto flex-1">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: bgColor }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <span className="text-[12px] font-semibold text-[#1E1B18] truncate flex-1">{node.label}</span>
          <span className="shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium" style={{ color, backgroundColor: bgColor }}>{fmtLabel}</span>
        </div>

        {node.relevanceScore > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#8C887F]">Relevance</span>
            <span className="text-[11px] font-medium text-[#6B6560]">{formatRelevance(node.relevanceScore)}</span>
          </div>
        )}

        {node.referenceCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#8C887F]">References</span>
            <span className="text-[11px] font-medium text-[#6B6560]">{node.referenceCount}</span>
          </div>
        )}

        {edge && edge.sectionLabels.length > 0 && (
          <div>
            <span className="text-[11px] text-[#8C887F] block mb-1">Referenced in sections</span>
            <div className="flex flex-wrap gap-1">
              {edge.sectionLabels.map((label) => (
                <span key={label} className="rounded-md px-1.5 py-px text-[10px] font-medium text-[#7C3AED] bg-[#F3F1FC]">{label}</span>
              ))}
            </div>
          </div>
        )}

        {edge && edge.description && (
          <div>
            <span className="text-[11px] text-[#8C887F] block mb-0.5">Description</span>
            <span className="text-[11px] text-[#6B6560] leading-relaxed">{edge.description}</span>
          </div>
        )}
      </div>
    </div>
  );
}
