"use client";

import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/lib/i18n";
import { getSearchResultBadge } from "@/lib/search/result-badge";
import type { SearchResult } from "@/types/documents";

interface SemanticResultsProps {
  results: SearchResult[];
  isSearching: boolean;
  searchMode: "keyword" | "semantic";
  resultMode?: "keyword" | "semantic";
  searchStage: number;
  needsSearchForSelectedMode?: boolean;
  onViewDocument?: (documentId: string) => void;
}

export function SemanticResults({ results, isSearching, searchMode, resultMode = searchMode, searchStage, needsSearchForSelectedMode = false, onViewDocument }: SemanticResultsProps) {
  const { locale, t } = useLocale();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const sr = t.search.semanticResults;
  const semanticStages = sr.semanticStages;
  const keywordStages = sr.keywordStages;
  return (
    <div className="space-y-3 animate-fade-in-up">
      {isSearching ? (
        <div className="flex flex-col items-center justify-center py-10">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="relative">
              <div className="w-12 h-12 border-[3px] border-primary/20 rounded-full" />
              <div className="absolute inset-0 w-12 h-12 border-[3px] border-transparent border-t-primary rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-foreground mb-1">
                {searchMode === "semantic"
                  ? semanticStages[searchStage]
                  : keywordStages[searchStage]}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {searchMode === "semantic"
                  ? sr.semanticHint
                  : sr.keywordHint}
              </p>
            </div>
            {searchMode === "semantic" && (
              <div className="flex gap-1.5 mt-1">
                {[0, 1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`h-1.5 rounded-full transition-all duration-500 ${s <= searchStage ? "bg-primary w-8" : "bg-muted w-4"}`}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="w-full max-w-2xl space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="relative bg-card border border-border rounded-[16px] p-5 animate-pulse overflow-hidden">
                <div className="flex justify-between items-center mb-3">
                  <div className="h-5 bg-muted rounded-lg w-48" />
                  <div className="h-6 w-20 bg-primary-100 rounded-full" />
                </div>
                <div className="space-y-2">
                  <div className="h-3.5 bg-muted rounded w-full" />
                  <div className="h-3.5 bg-muted rounded w-5/6" />
                  <div className="h-3.5 bg-muted rounded w-4/6" />
                </div>
                <div className="flex gap-4 mt-3">
                  <div className="h-3 bg-muted rounded w-24" />
                  <div className="h-3 bg-muted rounded w-32" />
                </div>
                <div
                  className="absolute inset-0 animate-[shimmer-slide_2.5s_ease-in-out_infinite] pointer-events-none"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.07), transparent)" }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : needsSearchForSelectedMode ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16">
              <circle cx="11" cy="11" r="8" />
              <path d="m8 11 2 2 4-5" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          title={searchMode === "semantic" ? sr.semanticSelected : sr.keywordSelected}
          description={searchMode === "semantic" ? sr.semanticSelectedDesc : sr.keywordSelectedDesc}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          title={t.search.noResults}
          description={t.search.noResultsDesc}
        />
      ) : (
        results.map((r, i) => {
          const isExpanded = expandedIndex === i;
          return (
            <div
              key={i}
              className="bg-card border border-border rounded-[16px] p-5 hover:border-primary/30 transition-all cursor-pointer"
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
            >
              <div className="flex justify-between items-center mb-2.5">
                <span className="font-semibold text-[15px] text-foreground">{r.documentName}</span>
                <div className="flex items-center gap-2">
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {(() => {
                    const badge = getSearchResultBadge(r, resultMode, locale);
                    return (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
                        {badge.text}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                {isExpanded ? (
                  r.content
                ) : (
                  <>
                    {r.content.slice(0, 300)}
                    {r.content.length > 300 && <span className="text-muted-foreground/50">...</span>}
                  </>
                )}
              </div>
              {isExpanded && (
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                  {onViewDocument && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onViewDocument(r.documentId); }}
                      className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline cursor-pointer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      {t.library.viewDocument}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExpandedIndex(null); }}
                    className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {sr.collapse}
                  </button>
                </div>
              )}
              {!isExpanded && (
                <div className="flex gap-4 mt-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    </svg>{" "}
                    {r.chunkId}
                  </span>
                  {r.title && <span>{r.title}</span>}
                  {r.source && <span>{sr.source}: {r.source}</span>}
                  {typeof r.rank === "number" && <span>{sr.rank}: #{r.rank}</span>}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
