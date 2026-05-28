"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
import { TopologyStatsBar } from "@/components/topology/topology-stats";
import type { TopologyResponse, GraphViewMode } from "@/types/topology";

interface DraftOption {
  id: string;
  title: string;
}

export default function TopologyPage() {
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<GraphViewMode>("documents");
  const [kgSearch, setKgSearch] = useState("");
  const [kgCenter, setKgCenter] = useState("");
  const kgCacheRef = useRef<TopologyResponse | null>(null);
  useEffect(() => {
    fetch("/api/v1/drafts?limit=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data) && d.data.length > 0) {
          const opts = d.data.map((draft: { id: string; title: string }) => ({
            id: draft.id,
            title: draft.title,
          }));
          setDrafts(opts);
          setSelectedDraftId(opts[0].id);
        }
        setLoading(false);
      });
  }, []);

  const loadTopology = useCallback(async (draftId: string) => {
    setLoading(true);
    setSelectedNodeId(null);
    const res = await fetch(`/api/v1/drafts/${draftId}/topology`);
    const d = await res.json();
    if (d.success) {
      setTopology(d.data);
    } else {
      setTopology(null);
    }
    setLoading(false);
  }, []);

  const loadKnowledgeGraph = useCallback(async (entity?: string) => {
    setLoading(true);
    setSelectedNodeId(null);
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
        setTopology(data);
        // Cache for fast switching
        if (!entity) kgCacheRef.current = data;
      } else {
        setTopology(null);
      }
    } catch {
      setTopology(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (graphMode === "documents") {
      if (selectedDraftId) loadTopology(selectedDraftId);
    } else if (kgCenter) {
      loadKnowledgeGraph(kgCenter);
    } else if (kgCacheRef.current && !kgCenter) {
      setTopology(kgCacheRef.current);
      setLoading(false);
    } else {
      loadKnowledgeGraph();
    }
  }, [selectedDraftId, graphMode, loadTopology, loadKnowledgeGraph, kgCenter]);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 3)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);
  const handleZoomFit = useCallback(() => setZoom(1), []);

  const selectedDraft = drafts.find((d) => d.id === selectedDraftId);

  return (
    <div>
      <Header title="Document Topology" />
      <div className="p-8 pt-4">
        {loading && !topology ? (
          <div className="flex items-center justify-center h-[calc(100vh-var(--header-height)-96px)]">
            <div className="text-center text-muted-foreground">
              <div className="w-10 h-10 mx-auto mb-3 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              <p>Loading {graphMode === "knowledge" ? "knowledge graph" : "topology"}...</p>
            </div>
          </div>
        ) : graphMode === "knowledge" && (!topology || topology.nodes.length === 0) ? (
          <div>
            <TopologyControls
              drafts={drafts}
              selectedDraftId={selectedDraftId}
              onDraftChange={setSelectedDraftId}
              zoom={zoom}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomFit={handleZoomFit}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
              kgSearch={kgSearch}
              onKgSearchChange={setKgSearch}
              onKgSearchSubmit={() => { if (kgSearch.trim()) { setKgCenter(kgSearch.trim()); setKgSearch(""); }}}
              kgCenter={kgCenter}
              onKgCenterClear={() => setKgCenter("")}
              totalEntities={topology?.stats?.totalEntities}
              totalRelations={topology?.stats?.totalRelations}
              leafCount={topology?.stats?.leafCount}
            />
            <div className="bg-muted border border-border rounded-[16px] min-h-[560px] flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <p className="text-sm">No knowledge graph yet.</p>
                <p className="text-xs mt-1">Index documents with &ldquo;Entity extraction + knowledge graph (Recommended)&rdquo; mode enabled.</p>
              </div>
            </div>
          </div>
        ) : drafts.length === 0 && graphMode === "documents" ? (
          <div className="flex items-center justify-center h-[calc(100vh-var(--header-height)-96px)]">
            <div className="text-center text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <p className="text-sm">No drafts yet. Create a draft from the writing page to see its topology.</p>
              <a href="/writing" className="text-primary text-sm font-medium hover:underline mt-2 inline-block">Go to Writing</a>
            </div>
          </div>
        ) : (
          <div>
            <TopologyControls
              drafts={drafts}
              selectedDraftId={selectedDraftId}
              onDraftChange={setSelectedDraftId}
              zoom={zoom}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomFit={handleZoomFit}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
              kgSearch={kgSearch}
              onKgSearchChange={setKgSearch}
              onKgSearchSubmit={() => { if (kgSearch.trim()) { setKgCenter(kgSearch.trim()); setKgSearch(""); }}}
              kgCenter={kgCenter}
              onKgCenterClear={() => setKgCenter("")}
              totalEntities={topology?.stats?.totalEntities}
              totalRelations={topology?.stats?.totalRelations}
              leafCount={topology?.stats?.leafCount}
            />
            {topology && topology.nodes.length > 0 ? (
              <TopologyCanvas
                nodes={topology.nodes}
                edges={topology.edges}
                zoom={zoom}
                selectedNodeId={selectedNodeId}
                onNodeClick={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  if (graphMode === "knowledge") {
                    const node = topology?.nodes.find(n => n.id === nodeId);
                    if (node) setKgCenter(node.label || nodeId);
                  }
                }}
                graphMode={graphMode}
              />
            ) : (
              <div className="bg-muted border border-border rounded-[16px] min-h-[560px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <p className="text-sm">No references found for this draft.</p>
                  <p className="text-xs mt-1">Generate sections with RAG search to build reference relationships.</p>
                </div>
              </div>
            )}
            {topology && <TopologyStatsBar stats={topology.stats} />}
          </div>
        )}
      </div>
    </div>
  );
}
