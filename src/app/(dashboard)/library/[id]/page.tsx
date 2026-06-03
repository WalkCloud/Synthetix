"use client";

import { useState, useEffect, use } from "react";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";
import { ChunkContent } from "@/components/library/chunk-content";
import type { DocumentMeta } from "@/types/documents";
import { useLocale } from "@/lib/i18n";

function topicColor(index: number): string {
  const colors = [
    "border-l-[#7C3AED] bg-violet-100 dark:bg-violet-950/20",
    "border-l-[#2563EB] bg-blue-100 dark:bg-blue-950/20",
    "border-l-[#16A34A] bg-emerald-100 dark:bg-emerald-950/20",
    "border-l-[#EA580C] bg-orange-100 dark:bg-orange-950/20",
    "border-l-[#D97706] bg-amber-100 dark:bg-amber-950/20",
  ];
  return colors[index % colors.length];
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, format } = useLocale();
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/v1/library/documents/${id}`);
      const data = await res.json();
      if (data.success) setDoc(data.data);
      setLoading(false);
    }
    load();
  }, [id]);

  function toggleChunk(chunkIndex: number) {
    const newExpanded = new Set(expandedChunks);
    if (newExpanded.has(chunkIndex)) {
      newExpanded.delete(chunkIndex);
    } else {
      newExpanded.add(chunkIndex);
    }
    setExpandedChunks(newExpanded);
  }

  if (loading) return <div><Header title={t.common.states.loading} /><LoadingState /></div>;
  if (!doc) return <div><Header title={t.errors.notFound} /><div className="p-8">{t.errors.documentNotFound}</div></div>;

  const chunks = doc.chunks || [];
  const isProcessing = ["uploading", "converting", "splitting", "embedding", "indexing"].includes(doc.status);
  const topicGroups = chunks.reduce((groups: Map<string, typeof chunks>, chunk) => {
    const hp = chunk.headingPath || "";
    const topic = hp.split(" > ")[0] || "Other";
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic)!.push(chunk);
    return groups;
  }, new Map<string, typeof chunks>());

  return (
    <div>
      <Header title={doc.originalName} />
      <div className="p-8 grid grid-cols-[1fr_320px] gap-6">
        {/* Main: structured chunk view */}
        <div className="space-y-4">
          {isProcessing && (
            <div className="bg-orange-100 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-950/30 rounded-[12px] p-4 flex items-center gap-3">
              <svg className="animate-spin w-5 h-5 text-orange-600 dark:text-orange-400" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{t.common.states.processing} — {doc.status}</span>
            </div>
          )}

          {chunks.length === 0 ? (
            <div className="bg-card border rounded-[16px] p-12 text-center text-muted-foreground">
              {isProcessing ? t.documents.upload.queuing : t.library.empty}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{chunks.length} {t.library.table.chunks.toLowerCase()}</span>
                <span>{topicGroups.size} topics</span>
                <span>— {format.number(doc.tokenEstimate || 0)} tokens</span>
              </div>

              {/* Topic groups */}
              {Array.from(topicGroups.entries()).map(([topic, topicChunks], ti) => (
                <div key={topic} className={`border-l-[3px] rounded-r-[12px] ${topicColor(ti)}`}>
                  <div className="px-4 pt-3 pb-2">
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      {topic} <span className="font-normal text-xs">({topicChunks.length})</span>
                    </h3>
                  </div>
                  <div className="space-y-1 px-4 pb-3">
                    {topicChunks.map((chunk) => {
                      const hp = chunk.headingPath || "";
                      const pathParts = hp.split(" > ");
                      const isExpanded = expandedChunks.has(chunk.index);

                      return (
                        <button
                          key={chunk.id}
                          onClick={() => toggleChunk(chunk.index)}
                          className={`w-full text-left rounded-[10px] transition-all border ${
                            isExpanded
                              ? "bg-card border-border shadow-sm"
                              : "bg-card/60 border-transparent hover:bg-card hover:border-border"
                          }`}
                        >
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="text-[14px] font-semibold text-foreground">
                                  {chunk.title || `Chunk ${chunk.index + 1}`}
                                </span>
                                {pathParts.length > 1 && (
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    {pathParts.slice(0, -1).map((part, i) => (
                                      <span key={i} className="text-[11px] text-muted-foreground/60">
                                        {part}<span className="mx-1">/</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                                {format.number(chunk.tokenCount ?? 0)} tokens
                              </span>
                            </div>

                            {isExpanded && chunk.content && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <ChunkContent content={chunk.content.slice(0, 4000)} docId={id} />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="bg-card border rounded-[16px] p-5">
            <h3 className="font-semibold mb-3">{t.library.table.name}</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t.library.table.format}</dt><dd className="font-medium uppercase">{doc.originalFormat}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t.library.table.size}</dt><dd className="font-medium">{format.fileSize(doc.originalSize)}</dd></div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t.library.table.status}</dt>
                <dd className="font-medium">
                  {doc.status === "ready" ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{t.common.states.ready}</span>
                  ) : doc.status === "failed" ? (
                    <span className="text-red-600 dark:text-red-400">{t.common.states.failed}</span>
                  ) : (
                    <span className="text-orange-600 dark:text-orange-400 capitalize">{doc.status}</span>
                  )}
                </dd>
              </div>
              {doc.wordCount != null && <div className="flex justify-between"><dt className="text-muted-foreground">Words</dt><dd className="font-medium">{format.number(doc.wordCount)}</dd></div>}
              {doc.tokenEstimate != null && <div className="flex justify-between"><dt className="text-muted-foreground">Tokens</dt><dd className="font-medium">{format.number(doc.tokenEstimate)}</dd></div>}
              {chunks.length > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t.library.table.chunks}</dt><dd className="font-medium">{chunks.length}</dd></div>}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
