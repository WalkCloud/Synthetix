"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { DocumentMeta, SearchResult } from "@/types/documents";
import type { TopologyResponse } from "@/types/topology";
import { SearchHero } from "@/components/library/search-hero";
import { StatsRibbon } from "@/components/library/stats-ribbon";
import { DocumentTable } from "@/components/library/document-table";
import { SemanticResults } from "@/components/library/semantic-results";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";

type TabId = "documents" | "search" | "knowledge-graph";

const tabItems: { id: TabId; label: string }[] = [
  { id: "documents", label: "Document Management" },
  { id: "search", label: "Document Search" },
  { id: "knowledge-graph", label: "Knowledge Graph" },
];

export default function LibraryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("documents");

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterFormat, setFilterFormat] = useState<string>("All");
  const [sortBy, setSortBy] = useState("Newest first");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [quickSearch, setQuickSearch] = useState("");
  const limit = 20;

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

  const fetchDocs = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (sortBy === "Name A-Z") { params.set("sort", "originalName"); params.set("order", "asc"); }
    else if (sortBy === "Size") { params.set("sort", "originalSize"); params.set("order", "desc"); }
    else { params.set("sort", "createdAt"); params.set("order", "desc"); }
    if (filterFormat !== "All") params.set("format", filterFormat.toLowerCase());
    if (filterStatus !== "all") params.set("status", filterStatus);
    const res = await fetch(`/api/v1/library/documents?${params}`);
    const data = await res.json();
    if (data.success) { setDocuments(data.data); setTotal(data.total); }
    setLoading(false);
  }, [sortBy, filterFormat, filterStatus]);

  useEffect(() => { if (activeTab === "documents") fetchDocs(page); }, [page, activeTab, fetchDocs]);

  useEffect(() => {
    if (activeTab !== "documents") return;
    const hasProcessing = documents.some((d) =>
      ["uploading", "converting", "splitting", "embedding", "indexing"].includes(d.status)
    );
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocs(page), 5000);
    return () => clearInterval(interval);
  }, [activeTab, documents, page, fetchDocs]);

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document and all its chunks?")) return;
    try {
      const res = await fetch(`/api/v1/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) return;
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        setTotal((t) => t - 1);
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  async function handleBatchDelete(ids: string[]) {
    if (!confirm(`Delete ${ids.length} selected documents and all their chunks?`)) return;
    try {
      const res = await fetch("/api/v1/documents/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return;
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) fetchDocs(page);
    } catch (e) {
      console.error("Batch delete failed:", e);
    }
  }

  async function handleReindex(docId: string) {
    const res = await fetch(`/api/v1/documents/${docId}/reprocess`, { method: "POST" });
    const data = await res.json();
    if (data.success) fetchDocs(page);
  }

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchStage(0);
    const isSemantic = searchMode === "semantic";
    const stages = isSemantic
      ? ["Initializing search engine...", "Embedding your query...", "Scanning knowledge graph...", "Ranking results..."]
      : ["Tokenizing query...", "Searching index...", "Ranking results..."];
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
      else { alert(data.error || "Search failed"); }
    } catch {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      alert("Network error or server unavailable.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchMode]);

  const statDocs = total || documents.length;
  const statChunks = documents.reduce((sum, d) => sum + (d.chunks?.length || 0), 0);
  const statReady = documents.filter((d) => d.status === "ready").length;
  const statIndexed = documents.length > 0 ? Math.round((statReady / documents.length) * 100) : 0;
  const statSize = documents.reduce((sum, d) => sum + d.originalSize, 0);
  const maxChunks = Math.max(1, ...documents.map((d) => d.chunks?.length || 0));

  const filteredDocs = quickSearch.trim()
    ? documents.filter((d) => d.originalName.toLowerCase().includes(quickSearch.toLowerCase()))
    : documents;

  return (
    <div>
      <Header title="Document Library" />
      <div className="p-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 font-sans cursor-pointer ${activeTab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "documents" && (
          <>
            <StatsRibbon
              docCount={statDocs}
              chunkCount={statChunks}
              indexedPct={statIndexed}
              totalSizeMb={(statSize / 1048576).toFixed(1)}
            />
            <DocumentTable
              documents={filteredDocs}
              loading={loading}
              filterFormat={filterFormat}
              setFilterFormat={(f) => { setFilterFormat(f); setPage(1); }}
              sortBy={sortBy}
              setSortBy={setSortBy}
              maxChunks={maxChunks}
              onDelete={handleDelete}
              onBatchDelete={handleBatchDelete}
              onReindex={handleReindex}
              onView={(id) => router.push(`/library/${id}`)}
              quickSearch={quickSearch}
              setQuickSearch={setQuickSearch}
              filterStatus={filterStatus}
              setFilterStatus={(s) => { setFilterStatus(s); setPage(1); }}
              totalCount={total}
            />
            {total > limit && (
              <div className="flex items-center justify-center gap-1 mt-6">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&laquo;</button>
                {Array.from({ length: Math.min(5, Math.ceil(total / limit)) }, (_, i) => {
                  const totalPages = Math.ceil(total / limit);
                  let p: number;
                  if (totalPages <= 5) p = i + 1;
                  else if (page <= 3) p = i + 1;
                  else if (page >= totalPages - 2) p = totalPages - 4 + i;
                  else p = page - 2 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`min-w-[36px] h-9 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${p === page ? "bg-primary text-white border-primary" : "border-border bg-card text-foreground hover:bg-secondary"}`}>{p}</button>
                  );
                })}
                <button onClick={() => setPage(Math.min(Math.ceil(total / limit), page + 1))} disabled={page >= Math.ceil(total / limit)}
                  className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&raquo;</button>
              </div>
            )}
          </>
        )}

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
                  <p>Loading knowledge graph...</p>
                </div>
              </div>
            ) : !kgTopology || kgTopology.nodes.length === 0 ? (
              <div className="bg-muted border border-border rounded-[16px] min-h-[560px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  <p className="text-sm">No knowledge graph yet.</p>
                  <p className="text-xs mt-1">Index documents with &ldquo;Entity extraction + knowledge graph&rdquo; mode enabled.</p>
                </div>
              </div>
            ) : (
              <TopologyCanvas
                nodes={kgTopology.nodes}
                edges={kgTopology.edges}
                zoom={kgZoom}
                selectedNodeId={kgSelectedNodeId}
                onNodeClick={(nodeId) => {
                  setKgSelectedNodeId(nodeId);
                  const node = kgTopology.nodes.find(n => n.id === nodeId);
                  if (node) setKgCenter(node.label || nodeId);
                }}
                graphMode="knowledge"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
