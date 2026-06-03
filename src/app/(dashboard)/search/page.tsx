"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { SearchResult } from "@/types/documents";
import type { TopologyResponse } from "@/types/topology";
import { SearchHero } from "@/components/library/search-hero";
import { SemanticResults } from "@/components/library/semantic-results";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
import { useLocale } from "@/lib/i18n";

type TabId = "search" | "knowledge-graph";

export default function SearchPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabId>("search");

  const tabItems: { id: TabId; label: string }[] = [
    { id: "search", label: t.search.title },
    { id: "knowledge-graph", label: t.documents.processing.indexModeGraph },
  ];

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const [kgTopology, setKgTopology] = useState<TopologyResponse | null>(null);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgZoom, setKgZoom] = useState(1);
  const [kgSearch, setKgSearch] = useState("");
  const [kgCenter, setKgCenter] = useState("");
  const [kgSelectedNodeId, setKgSelectedNodeId] = useState<string | null>(null);
  const [kgEntityDetailLoading, setKgEntityDetailLoading] = useState(false);
  const kgCacheRef = useRef<TopologyResponse | null>(null);

  const loadKnowledgeGraph = useCallback(async (entity?: string) => {
    setKgLoading(true);
    setKgSelectedNodeId(null);
    try {
      const params = new URLSearchParams({ depth: "2", max_nodes: "100", mode: "core" });
      if (entity) { params.set("entity", entity); params.set("mode", "graph"); }
      const res = await fetch(`/api/v1/knowledge/graph?${params}`);
      const d = await res.json();
      if (d.success && d.data?.graph) {
        const kg = d.data.graph;
        const stats = {
          totalReferences: 0, uniqueDocuments: 0, sectionsWithReferences: 0, totalSections: 0,
          mostReferencedDoc: null, coverage: "",
          totalEntities: kg.nodes?.length || 0,
          totalRelations: kg.edges?.length || 0,
          leafCount: d.data.leaf_count || 0,
        };
        const data: TopologyResponse = {
          draft: { id: "kg-root", title: entity || "Knowledge Graph", status: "ready" },
          nodes: kg.nodes.map((node: { id: string; label: string; type: string; description: string }) => ({
            id: node.id, type: "entity" as const,
            label: node.label || node.id?.slice(0, 30) || "Entity",
            format: "entity", referenceCount: 0, relevanceScore: 0,
            entityType: node.type || "entity",
            description: node.description || "",
          })),
          edges: kg.edges.map((edge: { source: string; target: string; label: string; weight: number; description: string }) => ({
            source: edge.source, target: edge.target,
            weight: edge.weight || 1, sectionIds: [], sectionLabels: [],
            description: edge.description,
          })),
          stats,
        };
        setKgTopology(data);
        if (!entity) kgCacheRef.current = data;
      } else {
        setKgTopology(null);
      }
    } catch {
      setKgTopology(null);
    }
    setKgLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab !== "knowledge-graph" || !kgSelectedNodeId) return;
    const node = kgTopology?.nodes.find(n => n.id === kgSelectedNodeId);
    if (!node) return;
    setKgEntityDetailLoading(true);
    fetch(`/api/v1/knowledge/entities/${encodeURIComponent(node.label || kgSelectedNodeId)}?depth=2&max_nodes=100`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.graph?.nodes) {
          const matchId = node.label || kgSelectedNodeId;
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
      .finally(() => setKgEntityDetailLoading(false));
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

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
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
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const data = await res.json();
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      if (data.success) { setSearchResults(data.data); }
      else { alert(data.error || t.errors.generationFailed); }
    } catch {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      alert(t.errors.networkError);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchMode, t]);

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
              results={searchResults}
              isSearching={isSearching}
              searchMode={searchMode}
              searchStage={searchStage}
              onViewDocument={(id) => router.push(`/library/${id}`)}
            />
          </>
        )}

        {activeTab === "knowledge-graph" && (
          <>
            <TopologyControls
              mode="knowledge"
              zoom={kgZoom}
              onZoomIn={() => setKgZoom((z) => Math.min(z + 0.2, 3))}
              onZoomOut={() => setKgZoom((z) => Math.max(z - 0.2, 0.4))}
              onZoomFit={() => setKgZoom(1)}
              kgSearch={kgSearch}
              onKgSearchChange={setKgSearch}
              onKgSearchSubmit={() => { if (kgSearch.trim()) { setKgCenter(kgSearch.trim()); setKgSearch(""); }}}
              kgCenter={kgCenter}
              onKgCenterClear={() => { setKgCenter(""); setKgTopology(kgCacheRef.current); }}
              totalEntities={kgTopology?.stats?.totalEntities}
              totalRelations={kgTopology?.stats?.totalRelations}
              leafCount={kgTopology?.stats?.leafCount}
            />
            {kgLoading && !kgTopology ? (
              <div className="flex items-center justify-center min-h-[560px]">
                <div className="text-center text-muted-foreground">
                  <div className="w-10 h-10 mx-auto mb-3 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                  <p>{t.common.states.loading}...</p>
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
              <TopologyCanvas
                nodes={kgTopology.nodes}
                edges={kgTopology.edges}
                zoom={kgZoom}
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
                  if (node) setKgCenter(node.label || nodeId);
                }}
                entityDetailLoading={kgEntityDetailLoading}
                graphMode="knowledge"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
