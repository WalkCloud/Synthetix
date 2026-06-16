"use client";

import type { TopologyEdge, TopologyNode } from "@/types/topology";

interface EvidenceChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  title: string | null;
  content: string;
  score: number;
}

interface EntityEvidencePanelProps {
  node: TopologyNode | null;
  edges: TopologyEdge[];
  onClose: () => void;
  isLoading?: boolean;
  chunks?: EvidenceChunk[];
  isZh: boolean;
}

export function EntityEvidencePanel({
  node,
  edges,
  onClose,
  isLoading = false,
  chunks = [],
  isZh,
}: EntityEvidencePanelProps) {
  if (!node) return null;

  const relatedEdges = edges.filter((edge) => edge.source === node.id || edge.target === node.id);

  return (
    <aside className="mt-4 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-600">
              {isZh ? "\u5b9e\u4f53\u8bc1\u636e" : "Entity Evidence"}
            </span>
            {isLoading && (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">{node.label || node.id}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {node.entityType || node.format || "entity"} · {relatedEdges.length} {isZh ? "\u6761\u5173\u7cfb" : "relations"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          aria-label={isZh ? "\u5173\u95ed\u5b9e\u4f53\u8bc1\u636e" : "Close entity evidence"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <section>
          <h4 className="text-xs font-semibold text-foreground mb-2">{isZh ? "\u8bf4\u660e" : "Description"}</h4>
          <p className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            {node.description || (isZh ? "\u6682\u65e0\u5b9e\u4f53\u8bf4\u660e\u3002\u70b9\u51fb\u5b9e\u4f53\u540e\u4f1a\u5c1d\u8bd5\u4ece\u77e5\u8bc6\u56fe\u8c31\u8865\u5168\u8bf4\u660e\u3002" : "No entity description yet. Selecting an entity attempts to enrich this from the knowledge graph.")}
          </p>
          <div className="mt-3">
            <h4 className="text-xs font-semibold text-foreground mb-2">{isZh ? "\u76f8\u5173\u6587\u6863\u7247\u6bb5" : "Related Document Chunks"}</h4>
            {chunks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                {isLoading ? (isZh ? "\u6b63\u5728\u68c0\u7d22\u76f8\u5173\u7247\u6bb5..." : "Retrieving related chunks...") : (isZh ? "\u6682\u65e0\u76f8\u5173\u7247\u6bb5\u3002" : "No related chunks yet.")}
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {chunks.map((chunk) => (
                  <div key={chunk.chunkId} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground truncate">{chunk.title || chunk.documentName}</span>
                      <span className="text-[10px] font-bold text-amber-600 tabular-nums">{Math.round(chunk.score * 100)}%</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate mb-1">{chunk.documentName}</div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-3">{chunk.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold text-foreground mb-2">{isZh ? "\u5173\u7cfb\u8bc1\u636e" : "Relation Evidence"}</h4>
          {relatedEdges.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
              {isZh ? "\u6682\u65e0\u8fde\u63a5\u5173\u7cfb\u3002" : "No connected relations."}
            </div>
          ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {relatedEdges.map((edge, index) => {
                const peer = edge.source === node.id ? edge.target : edge.source;
                return (
                  <div key={`${edge.source}-${edge.target}-${index}`} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground truncate">{peer}</span>
                      <span className="text-[10px] font-bold text-amber-600 tabular-nums">{edge.weight.toFixed(1)}</span>
                    </div>
                    {edge.description && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-3">{edge.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
