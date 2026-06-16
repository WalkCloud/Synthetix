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
  const isDraft = node.type === "draft";
  const totalSections = node.totalSections ?? 0;
  const completedSections = node.completedSections ?? 0;
  const sectionsWithReferences = node.sectionsWithReferences ?? 0;
  const totalReferences = node.totalReferences ?? node.referenceCount ?? 0;
  const uniqueDocuments = node.uniqueDocuments ?? 0;
  const coveragePercent = totalSections > 0 ? Math.round((sectionsWithReferences / totalSections) * 100) : 0;
  const etype = isDraft ? (isZh ? "主文档" : "draft") : node.entityType || "entity";
  const tc = typeColor(etype);
  const hasDescription = !!node.description;
  const draftStatusLabel = (status?: string) => {
    if (status === "completed") return isZh ? "已完成" : "Completed";
    if (status === "modifying") return isZh ? "修改中" : "Modifying";
    return isZh ? "草稿中" : "Drafting";
  };
  const coverageInsight = () => {
    if (totalSections === 0) return isZh ? "暂无章节可分析。" : "No sections to analyze yet.";
    if (coveragePercent >= 75) return isZh ? "参考资料覆盖较充分，可继续审阅章节内容。" : "Reference coverage is strong. Continue reviewing section content.";
    if (coveragePercent >= 40) return isZh ? "部分章节缺少参考资料，建议补充关键章节引用。" : "Some sections lack references. Add sources for key gaps.";
    return isZh ? "当前资料覆盖偏低，生成前建议补充更多参考文档。" : "Reference coverage is low. Add more source material before generating.";
  };
  const nextStep = () => {
    if (completedSections < totalSections) return isZh ? "继续生成或审阅未完成章节。" : "Continue generating or reviewing unfinished sections.";
    if (coveragePercent < 40) return isZh ? "优先补充缺少参考资料的章节。" : "Prioritize sections that lack references.";
    return isZh ? "进入写作页检查最终章节内容。" : "Open the writing page to review the final content.";
  };

  return (
    <div className="absolute right-4 top-4 z-30 w-[280px] max-h-[calc(100%-16px)] bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-xl flex flex-col">
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
          <span className="text-[13px] font-semibold text-foreground break-all flex-1">{node.label}</span>
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

        {isDraft && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground block mb-1">{isZh ? "文档状态" : "Document Status"}</span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">{draftStatusLabel(node.draftStatus)}</span>
                <span className="rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">{coveragePercent}% {isZh ? "覆盖" : "covered"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{isZh ? "章节进度" : "Sections"}</span>
                <span className="text-[13px] font-semibold text-foreground">{completedSections}/{totalSections}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{isZh ? "参考覆盖" : "Coverage"}</span>
                <span className="text-[13px] font-semibold text-foreground">{sectionsWithReferences}/{totalSections}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{isZh ? "引用总数" : "References"}</span>
                <span className="text-[13px] font-semibold text-foreground">{totalReferences}</span>
              </div>
              <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
                <span className="text-[10px] text-muted-foreground block">{isZh ? "资料来源" : "Sources"}</span>
                <span className="text-[13px] font-semibold text-foreground">{uniqueDocuments}</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground block mb-1">{isZh ? "资料覆盖洞察" : "Coverage Insight"}</span>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{coverageInsight()}</p>
              {node.mostReferencedDoc && (
                <p className="mt-1.5 text-[10px] text-muted-foreground break-all">{isZh ? "最常引用" : "Most referenced"}: {node.mostReferencedDoc}</p>
              )}
            </div>

            <div className="rounded-lg bg-primary/5 px-2.5 py-2">
              <span className="text-[11px] text-primary font-semibold block mb-1">{isZh ? "下一步" : "Next Step"}</span>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{nextStep()}</p>
            </div>

            <a
              href={`/writing/${node.id}`}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-primary/30 text-primary text-[11px] font-medium hover:bg-primary/5 transition-colors cursor-pointer"
            >
              {isZh ? "打开文档编写页" : "Open Writing Page"}
            </a>
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
