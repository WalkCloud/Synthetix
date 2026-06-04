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
  const { locale } = useLocale();
  const isZh = locale === "zh-CN";
  const etype = node.entityType || "entity";
  const tc = typeColor(etype);
  const hasDescription = !!node.description;

  return (
    <div className="absolute right-4 top-4 z-30 w-[280px] max-h-[calc(100%-32px)] bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-[12px] font-semibold text-foreground">{isZh ? "详情" : "Details"}</span>
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
          <span className="text-[13px] font-semibold text-foreground truncate flex-1">{node.label}</span>
          <span className="shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium" style={{ color: tc, backgroundColor: `${tc}15` }}>{etype}</span>
        </div>

        {node.type === "reference" && (
          <div className="text-[10px] text-muted-foreground">
            {isZh
              ? `${node.referenceCount} 次引用 · ${Math.round(node.relevanceScore * 100)}% 平均匹配`
              : `${node.referenceCount} ref${node.referenceCount !== 1 ? "s" : ""} · ${Math.round(node.relevanceScore * 100)}% avg match`}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-1">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-muted-foreground">{isZh ? "正在加载详情..." : "Loading details..."}</span>
          </div>
        )}

        {hasDescription && (
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">{isZh ? "描述" : "Description"}</span>
            <p className="text-[11px] text-foreground/80 leading-relaxed">{node.description}</p>
          </div>
        )}

        {node.referenceChunks && node.referenceChunks.length > 0 && (
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1.5">
              {isZh ? "引用来源" : "Reference Sources"} ({node.referenceChunks.length})
            </span>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {node.referenceChunks.map((chunk, i) => (
                <div key={i} className="rounded-lg bg-secondary/50 px-2.5 py-1.5">
                  {chunk.sourceAnchor && (
                    <p className="text-[11px] text-foreground font-medium truncate">{chunk.sourceAnchor}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground truncate flex-1">{chunk.sectionTitle}</span>
                    <span className="text-[10px] text-primary font-semibold shrink-0">{Math.round(chunk.relevanceScore * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasDescription && !node.referenceChunks?.length && !loading && (
          <p className="text-[11px] text-muted-foreground italic">{isZh ? "暂无更多信息。" : "No additional information available."}</p>
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
            {isZh ? "在图谱中查看" : "View in graph"}
          </button>
        )}
      </div>
    </div>
  );
}
