"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { GenerationMode, SectionMeta } from "@/types/writing";
import { isSectionDone } from "@/types/writing";

interface Reference {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
}

export function useGeneration(
  id: string,
  activeSectionId: string | null,
  loadDraft: () => Promise<void>,
  selectedModelA: string,
  selectedModelB: string,
) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSectionId, setGeneratingSectionId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);

  const handleGenerate = useCallback(
    async (
      mode: GenerationMode,
      constraints?: { wordLimit: number; additionalRequirements: string },
    ) => {
      const sectionId = activeSectionId;
      if (!sectionId) return;
      setIsGenerating(true);
      setGeneratingSectionId(sectionId);
      setStreamingContent("");
      setIsThinking(false);

      const endpoint =
        mode === "compare"
          ? `/api/v1/drafts/${id}/sections/${sectionId}/compare`
          : `/api/v1/drafts/${id}/sections/${sectionId}/generate`;

      const payload = {
        constraints,
        modelAConfigId: selectedModelA && selectedModelA !== "auto" ? selectedModelA : undefined,
        modelBConfigId: mode === "compare" && selectedModelB && selectedModelB !== "auto" ? selectedModelB : undefined,
      };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `Request failed (${res.status})`;
          try { const j = JSON.parse(text); msg = j.error || msg; } catch {}
          throw new Error(msg);
        }

        const isStream = res.headers.get("Content-Type")?.includes("text/event-stream");

        if (isStream) {
          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response stream");
          const decoder = new TextDecoder();
          let buffer = "";
          let contentBuf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let eolIndex;
            while ((eolIndex = buffer.indexOf("\n\n")) >= 0) {
              const message = buffer.slice(0, eolIndex).trim();
              buffer = buffer.slice(eolIndex + 2);
              if (message.startsWith("data: ")) {
                try {
                  const data = JSON.parse(message.slice(6));
                  if (data.type === "references") setReferences(data.references);
                  else if (data.type === "reasoning") setIsThinking(true);
                  else if (data.type === "chunk") {
                    setIsThinking(false);
                    contentBuf += data.content;
                    setStreamingContent(contentBuf);
                  } else if (data.type === "error") {
                    toast.error(data.error);
                  }
                } catch {}
              }
            }
          }
          await loadDraft();
          setStreamingContent("");
        } else {
          const data = await res.json();
          if (!data.success) {
            toast.error(data.error || "Generation failed");
          } else if (data.data && data.data.references) {
            setReferences(data.data.references);
          }
          await loadDraft();
        }
      } catch (err) {
        console.error("Generation failed:", err);
        toast.error(err instanceof Error ? err.message : "Generation failed");
      } finally {
        setIsGenerating(false);
        setGeneratingSectionId(null);
      }
    },
    [activeSectionId, id, loadDraft, selectedModelA, selectedModelB],
  );

  const handleConfirm = useCallback(async (
    setActiveSectionId: (id: string | null) => void,
  ) => {
    if (!activeSectionId) return;
    setIsConfirming(true);
    setStreamingContent("");
    setIsThinking(false);
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/confirm`,
        { method: "POST" },
      );
      if (res.ok) {
        const refresh = await fetch(`/api/v1/drafts/${id}`);
        const data = await refresh.json();
        if (data.success) {
          const freshSections: SectionMeta[] = data.data.sections;
          await loadDraft();
          const currentIdx = freshSections.findIndex((s) => s.id === activeSectionId);
          const nextPending = freshSections
            .slice(currentIdx + 1)
            .find((s) => s.status === "pending" || s.status === "failed");
          if (nextPending) {
            setActiveSectionId(nextPending.id);
          }
        }
      }
    } finally {
      setIsConfirming(false);
    }
  }, [activeSectionId, id, loadDraft]);

  const handleHumanize = useCallback(async () => {
    if (!activeSectionId) return;
    setIsHumanizing(true);
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/humanize`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!data.success) toast.error(data.error || "Humanize failed");
      await loadDraft();
    } catch (err) {
      console.error("Humanize failed:", err);
    }
    setIsHumanizing(false);
  }, [activeSectionId, id, loadDraft]);

  const handleUnlock = useCallback(async (targetStatus?: "reviewing" | "pending") => {
    if (!activeSectionId) return;
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetStatus: targetStatus || "reviewing" }),
        },
      );
      if (res.ok) await loadDraft();
    } catch {}
  }, [activeSectionId, id, loadDraft]);

  return {
    isGenerating,
    generatingSectionId,
    streamingContent,
    isThinking,
    isHumanizing,
    isConfirming,
    references,
    setReferences,
    handleGenerate,
    handleConfirm,
    handleHumanize,
    handleUnlock,
  };
}
