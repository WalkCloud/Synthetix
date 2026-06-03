"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
import { TopologyEmptyState } from "@/components/topology/topology-empty-state";
import { TopologyStatsBar } from "@/components/topology/topology-stats";
import type { TopologyResponse } from "@/types/topology";
import { useLocale } from "@/lib/i18n";

interface DraftOption {
  id: string;
  title: string;
}

export default function TopologyPage() {
  const { t } = useLocale();
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  useEffect(() => {
    if (selectedDraftId) loadTopology(selectedDraftId);
  }, [selectedDraftId, loadTopology]);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 3)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), []);
  const handleZoomFit = useCallback(() => setZoom(1), []);

  return (
    <div>
      <Header title={t.topology.title} />
      <div className="p-8 pt-4">
        {loading && !topology ? (
          <div className="flex items-center justify-center h-[calc(100vh-var(--header-height)-96px)]">
            <div className="text-center text-muted-foreground">
              <div className="w-10 h-10 mx-auto mb-3 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              <p>{t.common.states.loading}...</p>
            </div>
          </div>
        ) : drafts.length === 0 ? (
          <TopologyEmptyState variant="no-drafts" />
        ) : (
          <div>
            <TopologyControls
              mode="documents"
              drafts={drafts}
              selectedDraftId={selectedDraftId}
              onDraftChange={setSelectedDraftId}
              zoom={zoom}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomFit={handleZoomFit}
            />
            {topology && topology.nodes.length > 0 ? (
              <TopologyCanvas
                nodes={topology.nodes}
                edges={topology.edges}
                zoom={zoom}
                selectedNodeId={selectedNodeId}
                onNodeClick={setSelectedNodeId}
                graphMode="documents"
              />
            ) : (
              <TopologyEmptyState />
            )}
            {topology && <TopologyStatsBar stats={topology.stats} />}
          </div>
        )}
      </div>
    </div>
  );
}
