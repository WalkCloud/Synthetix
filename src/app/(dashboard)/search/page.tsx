"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import type { SearchResult } from "@/types/documents";
import type { TopologyResponse } from "@/types/topology";
import { SearchHero } from "@/components/library/search-hero";
import { SemanticResults } from "@/components/library/semantic-results";
import { KnowledgeGraphCanvas, type KnowledgeGraphCanvasHandle } from "@/components/knowledge/knowledge-graph-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
import { EntityEvidencePanel } from "@/components/topology/entity-evidence-panel";
import { useLocale } from "@/lib/i18n";
import { getVisibleSearchState, type SearchMode } from "@/lib/search/display-state";
import { getGraphProgressView, type GraphProgressView } from "@/lib/knowledge/graph-progress-view";
import { getGraphTaskDecision, type GraphTaskStatus } from "@/lib/knowledge/graph-task-status";
import { getKGLoadingProgress } from "@/lib/knowledge/graph-loading-stages";

type TabId = "search" | "knowledge-graph";

interface GraphTaskInfo {
  id: string;
  type: string;
  status: Exclude<GraphTaskStatus, "idle">;
  progress: number;
  result?: unknown;
  error?: string | null;
  updatedAt: string;
}

interface EntityEvidenceChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  title: string | null;
  content: string;
  score: number;
}

export default function SearchPage() {
  const { locale, t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabId>("search");

  const tabItems: { id: TabId; label: string }[] = [
    { id: "search", label: t.search.tabs.documentSearch },
    { id: "knowledge-graph", label: t.search.tabs.knowledgeGraph },
  ];

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchRequestRef = useRef(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [lastSearchMode, setLastSearchMode] = useState<SearchMode | null>(null);

  const [kgTopology, setKgTopology] = useState<TopologyResponse | null>(null);
  const [kgLoading, setKgLoading] = useState(false);
  const kgZoomRef = useRef<KnowledgeGraphCanvasHandle | null>(null);
  const [kgSearch, setKgSearch] = useState("");
  const [kgCenter, setKgCenter] = useState("");
  const [kgGraphNotice, setKgGraphNotice] = useState("");
  const [kgIndexingStatus, setKgIndexingStatus] = useState<GraphTaskStatus>("idle");
  const [kgIndexingProgress, setKgIndexingProgress] = useState(0);
  const [kgProgressView, setKgProgressView] = useState<GraphProgressView | null>(null);
  const [kgElapsed, setKgElapsed] = useState(0);
  const kgStartRef = useRef<number | null>(null);
  const kgElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [kgSelectedNodeId, setKgSelectedNodeId] = useState<string | null>(null);
  const [kgEntityDetailLoading, setKgEntityDetailLoading] = useState(false);
  const [kgEvidenceChunks, setKgEvidenceChunks] = useState<EntityEvidenceChunk[]>([]);
  const kgCacheRef = useRef<TopologyResponse | null>(null);
  const [kgLoadingElapsed, setKgLoadingElapsed] = useState(0);
  const [kgLoadingProgress, setKgLoadingProgress] = useState(0);
  const [kgLoadingStage, setKgLoadingStage] = useState("");
  const kgLoadingStartRef = useRef<number | null>(null);
  const kgLoadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopKgLoadingTimer = useCallback(() => {
    if (kgLoadingTimerRef.current) {
      clearInterval(kgLoadingTimerRef.current);
      kgLoadingTimerRef.current = null;
    }
  }, []);

  // Clear the loading timer if the component unmounts mid-fetch.
  useEffect(() => () => { stopKgLoadingTimer(); }, [stopKgLoadingTimer]);

  const missingEntityMessage = useCallback((entity: string) => (
    locale === "zh-CN"
      ? `未找到"${entity}"的关系图，已保留当前图谱。`
      : `No relationship graph found for "${entity}". Keeping the current graph.`
  ), [locale]);

  const loadKnowledgeGraph = useCallback(async (entity?: string) => {
    setKgLoading(true);
    setKgSelectedNodeId(null);
    kgLoadingStartRef.current = Date.now();
    setKgLoadingProgress(0);
    setKgLoadingElapsed(0);
    const tickLoading = () => {
      const elapsed = Date.now() - (kgLoadingStartRef.current || Date.now());
      const { stage, progress } = getKGLoadingProgress(elapsed);
      setKgLoadingElapsed(elapsed);
      setKgLoadingProgress(progress);
      setKgLoadingStage(stage);
    };
    tickLoading();
    stopKgLoadingTimer();
    kgLoadingTimerRef.current = setInterval(tickLoading, 200);
    try {
      const params = new URLSearchParams({ depth: "2", max_nodes: "150", mode: "core", min_degree: "1" });
      if (entity) { params.set("entity", entity); params.set("mode", "graph"); }
      const res = await fetch(`/api/v1/knowledge/graph?${params}`);
      const d = await res.json();
      if (d.success && d.data?.graph) {
        const kg = d.data.graph;
        const nodes = Array.isArray(kg.nodes) ? kg.nodes : [];
        const edges = Array.isArray(kg.edges) ? kg.edges : [];
        if (entity && nodes.length === 0) {
          setKgGraphNotice(missingEntityMessage(entity));
          return;
        }
        const stats = {
          totalReferences: 0, uniqueDocuments: 0, sectionsWithReferences: 0, totalSections: 0,
          mostReferencedDoc: null, coverage: "",
          totalEntities: nodes.length,
          totalRelations: edges.length,
          leafCount: d.data.leaf_count || 0,
        };
        const data: TopologyResponse = {
          draft: { id: "kg-root", title: entity || "Knowledge Graph", status: "ready" },
          nodes: nodes.map((node: { id: string; label: string; type: string; description: string }) => ({
            id: node.id, type: "entity" as const,
            label: node.label || node.id?.slice(0, 30) || "Entity",
            format: "entity", referenceCount: 0, relevanceScore: 0,
            entityType: node.type || "entity",
            description: node.description || "",
          })),
          edges: edges.map((edge: { source: string; target: string; label: string; weight: number; description: string }) => ({
            source: edge.source, target: edge.target,
            weight: edge.weight || 1, sectionIds: [], sectionLabels: [],
            description: edge.description,
          })),
          stats,
        };
        setKgTopology(data);
        setKgGraphNotice("");
        if (!entity && nodes.length > 0) kgCacheRef.current = data;
      } else {
        if (entity) {
          setKgGraphNotice(missingEntityMessage(entity));
        } else {
          setKgGraphNotice("");
          setKgTopology(null);
        }
      }
    } catch {
      if (entity) {
        setKgGraphNotice(missingEntityMessage(entity));
      } else {
        setKgGraphNotice("");
        setKgTopology(null);
      }
    } finally {
      stopKgLoadingTimer();
      setKgLoadingProgress(100);
      setKgLoading(false);
    }
  }, [missingEntityMessage, stopKgLoadingTimer]);

  const loadLatestGraphTask = useCallback(async (): Promise<GraphTaskInfo | null> => {
    const res = await fetch("/api/v1/tasks?type=rag_index&limit=1");
    const body = await res.json();
    if (!body.success || !Array.isArray(body.data) || body.data.length === 0) return null;
    return body.data[0] as GraphTaskInfo;
  }, []);

  useEffect(() => {
    if (activeTab !== "knowledge-graph" || !kgSelectedNodeId) return;
    const node = kgTopology?.nodes.find(n => n.id === kgSelectedNodeId);
    if (!node) return;
    setKgEntityDetailLoading(true);
    setKgEvidenceChunks([]);
    fetch(`/api/v1/knowledge/entities/${encodeURIComponent(node.id)}?depth=2&max_nodes=100`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.graph?.nodes) {
          const matchId = node.id;
          const detailNode = d.data.graph.nodes.find((n: { id: string }) => n.id === matchId);
          const detailEdges = d.data.graph.edges || [];
          setKgTopology(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              nodes: prev.nodes.map(n => {
                if (n.id !== kgSelectedNodeId) return n;
                return {
                  ...n,
                  description: n.description || (detailNode?.description || ""),
                  entityType: n.entityType || (detailNode?.type || "entity"),
                };
              }),
              edges: prev.edges.map(e => {
                if (e.source !== kgSelectedNodeId && e.target !== kgSelectedNodeId) return e;
                const match = detailEdges.find((de: { source: string; target: string }) =>
                  de.source === e.source && de.target === e.target);
                if (!match) return e;
                return {
                  ...e,
                  description: e.description || match.description || match.label || "",
                };
              }),
            };
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        fetch(`/api/v1/knowledge/entity-evidence?entity=${encodeURIComponent(node.id)}`)
          .then(r => r.json())
          .then(d => {
            if (d.success && Array.isArray(d.data?.documentChunks)) setKgEvidenceChunks(d.data.documentChunks);
          })
          .catch(() => {})
          .finally(() => setKgEntityDetailLoading(false));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, kgSelectedNodeId]);

  useEffect(() => {
    if (activeTab !== "knowledge-graph") return;
    if (kgCenter) {
      loadKnowledgeGraph(kgCenter);
    } else if (kgCacheRef.current && !kgCenter) {
      setKgTopology(kgCacheRef.current);
      setKgLoading(false);
    } else {
      loadKnowledgeGraph();
    }
  }, [activeTab, loadKnowledgeGraph, kgCenter]);

  useEffect(() => {
    if (activeTab !== "knowledge-graph" || kgCenter) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const task = await loadLatestGraphTask();
        if (cancelled) return;

        if (!task) {
          setKgIndexingStatus("idle");
          setKgIndexingProgress(0);
          setKgProgressView(null);
          return;
        }

        const decision = getGraphTaskDecision({
          taskStatus: task.status,
          hasGraphNodes: Boolean(kgTopology && kgTopology.nodes.length > 0),
        });

        setKgIndexingStatus(decision.status);
        setKgIndexingProgress(task.progress || 0);
        setKgProgressView(getGraphProgressView({ status: task.status, progress: task.progress || 0, result: task.result }));

        if (decision.shouldPollAgain) {
          timer = setTimeout(tick, 4000);
          return;
        }

        if (decision.shouldRefreshGraph) {
          kgCacheRef.current = null;
          await loadKnowledgeGraph();
        }
      } catch {
        if (!cancelled) setKgIndexingStatus("idle");
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab, kgCenter, kgTopology, loadKnowledgeGraph, loadLatestGraphTask]);

  useEffect(() => {
    const isActive = kgIndexingStatus === "pending" || kgIndexingStatus === "running";
    if (isActive && !kgStartRef.current) {
      kgStartRef.current = Date.now();
      kgElapsedRef.current = setInterval(() => {
        if (kgStartRef.current) setKgElapsed(Math.floor((Date.now() - kgStartRef.current) / 1000));
      }, 1000);
    } else if (!isActive && kgStartRef.current) {
      if (kgElapsedRef.current) { clearInterval(kgElapsedRef.current); kgElapsedRef.current = null; }
      kgStartRef.current = null;
      setKgElapsed(0);
    }
    return () => {
      if (kgElapsedRef.current) { clearInterval(kgElapsedRef.current); kgElapsedRef.current = null; }
    };
  }, [kgIndexingStatus]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setIsSearching(true);
    setSearchStage(0);
    const isSemantic = searchMode === "semantic";
    const stages = isSemantic
      ? [t.search.stages.semantic, t.search.stages.semantic, t.search.stages.semantic, t.search.stages.semantic]
      : [t.search.stages.keyword, t.search.stages.keyword, t.search.stages.keyword];
    let stageIdx = 0;
    const advanceInterval = isSemantic ? 2500 : 800;
    searchTimerRef.current = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, stages.length - 1);
      setSearchStage(stageIdx);
    }, advanceInterval);
    try {
      const endpoint = searchMode === "keyword" ? "/api/v1/library/search/keyword" : "/api/v1/library/search/semantic";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, mode: "mix", limit: 20 }),
      });
      const data = await res.json();
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      if (requestId !== searchRequestRef.current) return;
      if (data.success) {
        setSearchResults(data.data);
        setLastSearchMode(searchMode);
      }
      else { alert(data.error || t.errors.generationFailed); }
    } catch {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      alert(t.errors.networkError);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchMode, t]);

  const visibleSearchState = getVisibleSearchState({
    selectedMode: searchMode,
    lastSearchMode,
    resultsCount: searchResults.length,
    hasQuery: searchQuery.trim().length > 0,
  });

  return (
    <div>
      <Header title={t.search.title} />
      <div className="p-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 font-sans cursor-pointer ${activeTab === tab.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "search" && (
          <>
            <SearchHero
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchMode={searchMode}
              setSearchMode={setSearchMode}
              onSearch={handleSearch}
              isSearching={isSearching}
            />
            <SemanticResults
              results={visibleSearchState.shouldShowResults ? searchResults : []}
              isSearching={isSearching}
              searchMode={searchMode}
              resultMode={visibleSearchState.resultMode}
              searchStage={searchStage}
              needsSearchForSelectedMode={visibleSearchState.needsSearchForSelectedMode}
              onViewDocument={(id) => {}}
            />
          </>
        )}

        {activeTab === "knowledge-graph" && (
          <>
            <TopologyControls
              mode="knowledge"
              zoom={1}
              onZoomIn={() => kgZoomRef.current?.zoomBy(1.2)}
              onZoomOut={() => kgZoomRef.current?.zoomBy(1 / 1.2)}
              onZoomFit={() => kgZoomRef.current?.zoomToFit()}
              kgSearch={kgSearch}
              onKgSearchChange={setKgSearch}
              onKgSearchSubmit={(entityName) => {
                const nextCenter = (entityName ?? kgSearch).trim();
                if (!nextCenter) return;
                setKgGraphNotice("");
                if (nextCenter === kgCenter) {
                  loadKnowledgeGraph(nextCenter);
                } else {
                  setKgCenter(nextCenter);
                }
                setKgSearch("");
              }}
              kgCenter={kgCenter}
              onKgCenterClear={() => {
                setKgGraphNotice("");
                setKgSelectedNodeId(null);
                setKgCenter("");
                if (kgCacheRef.current) setKgTopology(kgCacheRef.current);
              }}
              totalEntities={kgTopology?.stats?.totalEntities}
              totalRelations={kgTopology?.stats?.totalRelations}
              leafCount={kgTopology?.stats?.leafCount}
            />
            {kgGraphNotice && (
              <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300">
                {kgGraphNotice}
              </div>
            )}
            {(kgIndexingStatus === "pending" || kgIndexingStatus === "running") && (
              <div className="mb-4 overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04] text-foreground">
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    <p className="text-sm font-semibold flex-1">{t.search.knowledgeGraphBuilding}</p>
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">{kgIndexingProgress}%</span>
                    {kgElapsed > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.search.graphElapsed} {Math.floor(kgElapsed / 60)}:{String(kgElapsed % 60).padStart(2, "0")}
                      </span>
                    )}
                  </div>

                  <div className="relative h-2 overflow-hidden rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary/80 transition-all duration-700 ease-out"
                      style={{ width: `${Math.max(8, kgIndexingProgress)}%` }}
                    />
                    <div
                      className="absolute inset-y-0 w-1/3 animate-[shimmer-slide_2s_ease-in-out_infinite] rounded-full"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.3), transparent)",
                        left: `${Math.max(4, kgIndexingProgress - 15)}%`,
                      }}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {t.search.graphActive}
                    </span>
                    <span>{t.search.graphStageLabel}: {kgProgressView?.stage || "indexing"}</span>
                    {kgProgressView?.chunkLabel && <span>{kgProgressView.chunkLabel}</span>}
                    {kgProgressView?.heartbeatLabel && <span>{kgProgressView.heartbeatLabel}</span>}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    {kgProgressView?.isSlow ? t.search.knowledgeGraphSlowHint : t.search.knowledgeGraphRunningHint}
                  </p>
                </div>
              </div>
            )}
            {kgLoading && !kgTopology ? (
              <div className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04] text-foreground min-h-[560px] flex flex-col justify-center">
                <div className="p-6 max-w-xl mx-auto w-full animate-fade-in-up">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    <p className="text-sm font-semibold flex-1">{t.search.kgLoadingTitle}</p>
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
                      {Math.round(kgLoadingProgress)}%
                      <span className="ml-1 font-normal text-primary/60">· {t.search.kgLoadingEstimate}</span>
                    </span>
                    {kgLoadingElapsed > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.search.graphElapsed} {Math.floor(kgLoadingElapsed / 1000)}s
                      </span>
                    )}
                  </div>

                  <div className="relative h-2 overflow-hidden rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary/80 transition-all duration-300 ease-out"
                      style={{ width: `${Math.max(8, kgLoadingProgress)}%` }}
                    />
                    <div
                      className="absolute inset-y-0 w-1/3 animate-[shimmer-slide_2s_ease-in-out_infinite] rounded-full"
                      style={{
                        background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.3), transparent)",
                        left: `${Math.max(4, kgLoadingProgress - 15)}%`,
                      }}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      {t.search.graphActive}
                    </span>
                    {kgLoadingStage && (
                      <span>
                        {t.search.graphStageLabel}: {
                          kgLoadingStage === "loadingStageInit" ? t.search.loadingStageInit
                          : kgLoadingStage === "loadingStageTraverse" ? t.search.loadingStageTraverse
                          : t.search.loadingStageBuild
                        }
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    {t.search.kgLoadingHint}
                  </p>
                </div>
              </div>
            ) : !kgTopology || kgTopology.nodes.length === 0 ? (
              <div className="bg-muted border border-border rounded-[16px] min-h-[560px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  <p className="text-sm">{t.topology.empty}</p>
                  <p className="text-xs mt-1">{t.topology.emptyDesc}</p>
                </div>
              </div>
            ) : (
              <>
                <KnowledgeGraphCanvas
                  nodes={kgTopology.nodes}
                  edges={kgTopology.edges}
                  selectedNodeId={kgSelectedNodeId}
                  onNodeClick={(nodeId) => {
                    if (!nodeId) {
                      setKgSelectedNodeId(null);
                      return;
                    }
                    if (kgSelectedNodeId === nodeId) {
                      setKgSelectedNodeId(null);
                      return;
                    }
                    setKgSelectedNodeId(nodeId);
                  }}
                  onNodeDblClick={(nodeId) => {
                    const node = kgTopology.nodes.find(n => n.id === nodeId);
                    if (node) {
                      setKgGraphNotice("");
                      setKgCenter(node.id);
                    }
                  }}
                  zoomRef={kgZoomRef}
                  entityDetailLoading={kgEntityDetailLoading}
                />
                <EntityEvidencePanel
                  node={kgTopology.nodes.find((node) => node.id === kgSelectedNodeId) || null}
                  edges={kgTopology.edges}
                  onClose={() => setKgSelectedNodeId(null)}
                  isLoading={kgEntityDetailLoading}
                  chunks={kgEvidenceChunks}
                  isZh={locale === "zh-CN"}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
