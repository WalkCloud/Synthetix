"use client";

import { useState, useEffect, useCallback } from "react";
import type { DraftMeta, SectionMeta } from "@/types/writing";
import { isSectionDone } from "@/types/writing";

interface DraftDetail extends DraftMeta {
  sections: SectionMeta[];
}

export function useDraftData(id: string) {
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDraft = useCallback(async () => {
    const res = await fetch(`/api/v1/drafts/${id}`);
    const data = await res.json();
    if (data.success) {
      setDraft(data.data);
      setActiveSectionId((prev) => {
        if (prev) return prev;
        if (data.data.sections.length > 0) {
          const firstPending = data.data.sections.find(
            (s: SectionMeta) => !isSectionDone(s.status),
          );
          return firstPending?.id || data.data.sections[0].id;
        }
        return prev;
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadDraft();
  }, [id, loadDraft]);

  return { draft, setDraft, activeSectionId, setActiveSectionId, loading, loadDraft };
}
