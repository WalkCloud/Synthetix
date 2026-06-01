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
      } else {
        console.warn("[loadAssets] failed:", data.error, "sectionId:", activeSectionId);
      }
    } catch {
      console.warn("[loadAssets] fetch error sectionId:", activeSectionId);
    }
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

  const handleInsertAsset = useCallback(async (markerId: string, assetId: string) => {
    if (!activeSectionId) return null;
    try {
      // Case 1: No markerId — append [IMAGE:assetId] to section content directly
      if (!markerId) {
        const sectionRes = await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`);
        if (!sectionRes.ok) return null;
        const sectionData = await sectionRes.json();
        const content = sectionData?.data?.content || sectionData?.content || "";
        const marker = `[IMAGE:${assetId}]`;
        if (content.includes(marker)) {
          // Already inserted
          return content;
        }
        const updatedContent = content + "\n\n" + marker;
        await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: updatedContent }),
        });
        await loadDraft();
        return updatedContent;
      }

      // Case 2: With markerId — replace existing marker via confirm-asset API
      const res = await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}/assets/confirm-asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markerId, assetId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Insert failed" }));
        console.error("[handleInsertAsset] confirm-asset failed:", res.status, err);
        const { toast } = await import("sonner");
        toast.error(err.error || "Failed to insert image");
        return null;
      }
      const data = await res.json();
      await loadDraft();
      return data.content as string;
    } catch (e) {
      console.error("[handleInsertAsset] error:", e);
      return null;
    }
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
