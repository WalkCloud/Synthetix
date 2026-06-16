"use client";

import { useMemo, useState } from "react";
import { ChunkContent } from "@/components/library/chunk-content";
import type { ChunkMeta } from "@/types/documents";

interface ChunksPanelProps {
  chunks: ChunkMeta[];
  docId: string;
  isZh: boolean;
  format: { number: (value: number) => string };
}

function topicColor(index: number): string {
  const colors = [
    "border-l-[#7C3AED] bg-violet-50/60 dark:bg-violet-950/10",
    "border-l-[#2563EB] bg-blue-50/60 dark:bg-blue-950/10",
    "border-l-[#16A34A] bg-emerald-50/60 dark:bg-emerald-950/10",
    "border-l-[#EA580C] bg-orange-50/60 dark:bg-orange-950/10",
    "border-l-[#D97706] bg-amber-50/60 dark:bg-amber-950/10",
  ];
  return colors[index % colors.length];
}

const CHUNKS_PER_TOPIC = 10;

export function ChunksPanel({ chunks, docId, isZh, format }: ChunksPanelProps) {
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const topicGroups = useMemo(() => chunks.reduce((groups: Map<string, ChunkMeta[]>, chunk) => {
    const hp = chunk.headingPath || "";
    const topic = hp.split(" > ")[0] || (isZh ? "\u5176\u4ed6" : "Other");
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic)!.push(chunk);
    return groups;
  }, new Map<string, ChunkMeta[]>()), [chunks, isZh]);

  function toggleChunk(idx: number) {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleTopic(topic: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic); else next.add(topic);
      return next;
    });
  }

  if (chunks.length === 0) {
    return (
      <div className="bg-card border rounded-2xl p-12 text-center text-muted-foreground">
        {isZh ? "\u6682\u65e0\u68c0\u7d22\u5207\u7247" : "No retrieval chunks yet."}
      </div>
    );
  }

  const totalTokens = chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary stats \u2014 pill style matching domain panel */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/20 text-xs font-medium text-blue-700 dark:text-blue-300">
          <span className="font-bold">{chunks.length}</span> {isZh ? "\u4e2a\u5207\u7247" : "chunks"}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 text-xs font-medium text-muted-foreground">
          <span className="font-bold text-foreground">{topicGroups.size}</span> {isZh ? "\u4e2a\u4e3b\u9898\u5206\u7ec4" : "topic groups"}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 text-xs font-medium text-muted-foreground">
          <span className="font-bold text-foreground">{format.number(totalTokens)}</span> tokens
        </span>
      </div>

      <div className="space-y-3">
        {Array.from(topicGroups.entries()).map(([topic, topicChunks], index) => {
          const isExpanded = expandedTopics.has(topic);
          const visibleChunks = isExpanded ? topicChunks : topicChunks.slice(0, CHUNKS_PER_TOPIC);
          const hasMore = topicChunks.length > CHUNKS_PER_TOPIC;

          return (
            <div key={topic} className={`border-l-[3px] rounded-r-xl ${topicColor(index)}`}>
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {topic} <span className="font-normal text-xs">({topicChunks.length})</span>
                </h3>
              </div>
              <div className="space-y-1 px-4 pb-3">
                {visibleChunks.map((chunk) => {
                  const isExpanded = expandedChunks.has(chunk.index);
                  return (
                    <div
                      key={chunk.id}
                      className={`rounded-xl transition-all border ${
                        isExpanded
                          ? "bg-card border-border shadow-sm"
                          : "bg-card/60 border-transparent hover:bg-card hover:border-border"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleChunk(chunk.index)}
                        className="w-full text-left p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{chunk.title || (isZh ? `\u5207\u7247 ${chunk.index + 1}` : `Chunk ${chunk.index + 1}`)}</span>
                          <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0 tabular-nums">{format.number(chunk.tokenCount ?? 0)} tok</span>
                        </div>
                        {chunk.headingPath && <div className="mt-1 text-[11px] text-muted-foreground truncate">{chunk.headingPath}</div>}
                      </button>
                      {isExpanded && chunk.content && (
                        <div className="px-3 pb-3 pt-0">
                          <div className="border-t border-border pt-3">
                            <ChunkContent content={chunk.content.slice(0, 4000)} docId={docId} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {hasMore && !isExpanded && (
                  <button
                    type="button"
                    onClick={() => toggleTopic(topic)}
                    className="w-full text-center py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isZh ? `\u663e\u793a\u5168\u90e8 ${topicChunks.length} \u4e2a\u5207\u7247` : `Show all ${topicChunks.length} chunks`}
                  </button>
                )}
                {isExpanded && hasMore && (
                  <button
                    type="button"
                    onClick={() => toggleTopic(topic)}
                    className="w-full text-center py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isZh ? "\u6536\u8d77" : "Collapse"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
