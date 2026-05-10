"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
import { TopologyLegend } from "@/components/topology/topology-legend";
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
  const [refFilter, setRefFilter] = useState("all");
  const [groupBy, setGroupBy] = useState("document");
  const [graphMode, setGraphMode] = useState<GraphViewMode>("documents");

  useEffect(() => {
    fetch("/api/v1/drafts?limit=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data.length > 0) {
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

  const loadKnowledgeGraph = useCallback(async () => {
    setLoading(true);
    setSelectedNodeId(null);
    try {
      const res = await fetch("/api/v1/knowledge/graph?depth=3&max_nodes=100");
      const d = await res.json();
      if (d.success && d.data?.graph) {
        const kg = d.data.graph;
        setTopology({
          draft: { id: "kg-root", title: "Knowledge Graph", status: "ready" },
          nodes: kg.nodes.map((node: { id: string; label: string; type: string; description: string }) => ({
            id: node.id,
            type: "entity" as const,
            label: node.label,
            format: "entity",
            referenceCount: 0,
            relevanceScore: 0,
            entityType: node.type,
          })),
          edges: kg.edges.map((edge: { source: string; target: string; label: string; weight: number; description: string }) => ({
            source: edge.source,
            target: edge.target,
            weight: edge.weight || 1,
            sectionIds: [],
            sectionLabels: [],
            description: edge.description,
          })),
          stats: {
            totalReferences: 0,
            uniqueDocuments: 0,
            sectionsWithReferences: 0,
            totalSections: 0,
            mostReferencedDoc: null,
            coverage: "",
            totalEntities: kg.nodes?.length || 0,
            totalRelations: kg.edges?.length || 0,
          },
        });
      } else {
        setTopology({ draft: { id: "", title: "", status: "" }, nodes: [], edges: [], stats: { totalReferences: 0, uniqueDocuments: 0, sectionsWithReferences: 0, totalSections: 0, mostReferencedDoc: null, coverage: "" } });
      }
    } catch {
      setTopology(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (graphMode === "documents") {
      if (selectedDraftId) loadTopology(selectedDraftId);
    } else {
      loadKnowledgeGraph();
    }
  }, [selectedDraftId, graphMode, loadTopology, loadKnowledgeGraph]);

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
            <div className="text-center text-[#A1A1AA]">
              <div className="w-10 h-10 mx-auto mb-3 border-3 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
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
              refFilter={refFilter}
              onRefFilterChange={setRefFilter}
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
            />
            <div className="bg-[#F5F5F3] border border-[#E4E4E7] rounded-[16px] min-h-[560px] flex items-center justify-center">
              <div className="text-center text-[#A1A1AA]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <p className="text-sm">No knowledge graph yet.</p>
                <p className="text-xs mt-1">Index documents with &ldquo;Entity extraction + knowledge graph&rdquo; mode enabled.</p>
              </div>
            </div>
          </div>
        ) : drafts.length === 0 && graphMode === "documents" ? (
          <div className="flex items-center justify-center h-[calc(100vh-var(--header-height)-96px)]">
            <div className="text-center text-[#A1A1AA]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <p className="text-sm">No drafts yet. Create a draft from the writing page to see its topology.</p>
              <a href="/writing" className="text-[#4361EE] text-sm font-medium hover:underline mt-2 inline-block">Go to Writing</a>
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
              refFilter={refFilter}
              onRefFilterChange={setRefFilter}
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              graphMode={graphMode}
              onGraphModeChange={setGraphMode}
            />
            <TopologyLegend />
            {topology && topology.nodes.length > 0 ? (
              <TopologyCanvas
                nodes={topology.nodes}
                edges={topology.edges}
                zoom={zoom}
                selectedNodeId={selectedNodeId}
                onNodeClick={setSelectedNodeId}
              />
            ) : (
              <div className="bg-[#F5F5F3] border border-[#E4E4E7] rounded-[16px] min-h-[560px] flex items-center justify-center">
                <div className="text-center text-[#A1A1AA]">
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
