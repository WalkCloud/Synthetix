"use client";

import { useCallback, useEffect, useState } from "react";

interface SectionAssetItem {
  id: string;
  type: string;
  title: string;
  status: string;
  mimeType?: string | null;
  prompt?: string | null;
}

interface AssetApiResponse {
  id: string;
  type: string;
  title: string;
  status: string;
  mimeType?: string | null;
  prompt?: string | null;
}

export function useSectionActions(
  id: string,
  activeSectionId: string | null,
  loadDraft: () => Promise<void>,
) {
  const [sectionAssets, setSectionAssets] = useState<SectionAssetItem[]>([]);

  const loadAssets = useCallback(async () => {
    if (!activeSectionId) { setSectionAssets([]); return; }
    try {
      const res = await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}/assets`);
      const data = await res.json();
      if (data.success) {
        setSectionAssets(
          (data.data || []).map((a: AssetApiResponse) => ({
            id: a.id,
            type: a.type,
            title: a.title,
            status: a.status,
            mimeType: a.mimeType,
            prompt: a.prompt,
          })),
        );
      }
    } catch {}
  }, [id, activeSectionId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const handleSelectModel = useCallback(
    async (source: "a" | "b") => {
      if (!activeSectionId) return;
      const res = await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedSource: source }),
      });
      if (res.ok) await loadDraft();
    },
    [activeSectionId, id, loadDraft],
  );

  const handleSaveEdit = useCallback(async (content: string) => {
    if (!activeSectionId) return;
    try {
      await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await loadDraft();
    } catch {}
  }, [id, activeSectionId, loadDraft]);

  const handleSaveEstimatedWords = useCallback(async (words: number) => {
    if (!activeSectionId) return;
    try {
      await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedWords: words }),
      });
    } catch {}
  }, [id, activeSectionId]);

  const handleInsertAsset = useCallback(async (assetId: string, currentContent: string) => {
    if (!activeSectionId) return;
    const marker = `\n[IMAGE:${assetId}]\n`;
    const updated = currentContent + marker;
    try {
      await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: updated }),
      });
      await loadDraft();
    } catch {}
  }, [id, activeSectionId, loadDraft]);

  const handleRagConfigChange = useCallback(async (ragMode: string, ragDocumentIds: string[]) => {
    if (!activeSectionId) return;
    try {
      await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragMode, ragDocumentIds }),
      });
      await loadDraft();
    } catch {}
  }, [id, activeSectionId, loadDraft]);

  return {
    sectionAssets,
    loadAssets,
    handleSelectModel,
    handleSaveEdit,
    handleSaveEstimatedWords,
    handleInsertAsset,
    handleRagConfigChange,
  };
}
