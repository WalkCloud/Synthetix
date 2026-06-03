"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { TopologyCanvas } from "@/components/topology/topology-canvas";
import { TopologyControls } from "@/components/topology/topology-controls";
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
          <div className="flex items-center justify-center h-[calc(100vh-var(--header-height)-96px)]">
            <div className="text-center text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <p className="text-sm">{t.topology.empty}</p>
              <Link href="/writing" className="text-primary text-sm font-medium hover:underline mt-2 inline-block">{t.layout.sidebar.documentWriting}</Link>
            </div>
          </div>
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
              <div className="bg-muted border border-border rounded-[16px] min-h-[560px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <p className="text-sm">{t.topology.empty}</p>
                  <p className="text-xs mt-1">{t.topology.emptyDesc}</p>
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
