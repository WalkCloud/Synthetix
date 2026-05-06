"use client";

import type { TopologyNode, TopologyEdge } from "@/types/topology";

interface TopologyDetailPanelProps {
  readonly node: TopologyNode;
  readonly edge: TopologyEdge;
  readonly onClose: () => void;
}

const FORMAT_CONFIG: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  pdf: { color: "#2563EB", bg: "#EFF6FF", label: "PDF" },
  docx: { color: "#EA580C", bg: "#FFF7ED", label: "DOCX" },
  md: { color: "#16A34A", bg: "#F0FDF4", label: "MD" },
  markdown: { color: "#16A34A", bg: "#F0FDF4", label: "MD" },
  draft: { color: "#4361EE", bg: "#EEF0FD", label: "Draft" },
} as const;

function getFormatConfig(format: string) {
  const key = format.toLowerCase();
  return FORMAT_CONFIG[key] ?? { color: "#4361EE", bg: "#EEF0FD", label: format };
}

function FormatIcon({ format }: { readonly format: string }) {
  const cfg = getFormatConfig(format);

  if (cfg.label === "PDF") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={cfg.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    );
  }

  if (cfg.label === "DOCX") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={cfg.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    );
  }

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={cfg.color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) {
    return "Unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelevance(score: number): { text: string; isHigh: boolean } {
  const percentage = Math.round(score * 100);
  return { text: `${percentage}%`, isHigh: percentage >= 70 };
}

const BUTTON_CLASSES =
  "flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors cursor-pointer";

export function TopologyDetailPanel({
  node,
  edge,
  onClose,
}: TopologyDetailPanelProps) {
  const cfg = getFormatConfig(node.format);
  const relevance = formatRelevance(node.relevanceScore);

  return (
    <div className="absolute right-5 top-5 z-20 w-[280px] bg-white rounded-2xl border border-[#E4E4E7] shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E4E7]">
        <span className="text-[13px] font-semibold text-[#18181B]">
          Node Details
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-md text-[#A1A1AA] hover:text-[#18181B] hover:bg-[#F5F5F3] transition-colors cursor-pointer"
          aria-label="Close detail panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Document name + format tag */}
        <div className="flex items-center gap-2">
          <FormatIcon format={node.format} />
          <span className="text-[13px] font-semibold text-[#18181B] truncate flex-1">
            {node.label}
          </span>
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
            style={{ color: cfg.color, backgroundColor: cfg.bg }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Size */}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#A1A1AA]">Size</span>
          <span className="text-[12px] text-[#52525B]">
            {formatFileSize(node.size)}
          </span>
        </div>

        {/* Relevance */}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#A1A1AA]">Relevance</span>
          <span
            className={`text-[12px] font-medium ${
              relevance.isHigh ? "text-green-600" : "text-[#52525B]"
            }`}
          >
            {relevance.text}
          </span>
        </div>

        {/* Referenced in */}
        {edge.sectionLabels.length > 0 && (
          <div>
            <span className="text-[12px] text-[#A1A1AA] block mb-1.5">
              Referenced in
            </span>
            <div className="flex flex-wrap gap-1.5">
              {edge.sectionLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-[#4361EE] bg-[#EEF0FD]"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Source anchors placeholder */}
        <div>
          <span className="text-[12px] text-[#A1A1AA] block mb-1.5">
            Source Anchors
          </span>
          <span className="text-[12px] text-[#A1A1AA] italic">
            Available in P5
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className={`${BUTTON_CLASSES} border border-[#E4E4E7] text-[#18181B] hover:bg-[#F5F5F3]`}
          >
            View Doc
          </button>
          <button
            type="button"
            className={`${BUTTON_CLASSES} bg-[#4361EE] text-white hover:bg-[#3651D4]`}
          >
            Open in Library
          </button>
        </div>
      </div>
    </div>
  );
}
