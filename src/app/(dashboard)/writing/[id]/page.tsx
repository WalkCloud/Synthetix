"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { OutlinePanel } from "@/components/writing/outline-panel";
import { EditorPanel } from "@/components/writing/editor-panel";
import { ReferencePanel } from "@/components/writing/reference-panel";
import type { DraftMeta, SectionMeta, GenerationMode } from "@/types/writing";

interface DraftDetail extends DraftMeta {
  sections: SectionMeta[];
}

interface Reference {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
}

export default function WritingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [sectionNotes, setSectionNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  const activeSection = draft?.sections.find((s) => s.id === activeSectionId) || null;

  const loadDraft = useCallback(async () => {
    const res = await fetch(`/api/v1/drafts/${id}`);
    const data = await res.json();
    if (data.success) {
      setDraft(data.data);
      if (!activeSectionId && data.data.sections.length > 0) {
        const firstPending = data.data.sections.find(
          (s: SectionMeta) => s.status !== "locked" && s.status !== "summarized"
        );
        setActiveSectionId(firstPending?.id || data.data.sections[0].id);
      }
    }
    setLoading(false);
  }, [id, activeSectionId]);

  useEffect(() => {
    loadDraft();
  }, [id]);

  const handleGenerate = useCallback(
    async (mode: GenerationMode) => {
      if (!activeSectionId) return;
      setIsGenerating(true);

      const endpoint =
        mode === "compare"
          ? `/api/v1/drafts/${id}/sections/${activeSectionId}/compare`
          : `/api/v1/drafts/${id}/sections/${activeSectionId}/generate`;

      try {
        const res = await fetch(endpoint, { method: "POST" });
        const data = await res.json();
        if (data.success && data.data.references) {
          setReferences(data.data.references);
        }
        await loadDraft();
      } catch (err) {
        console.error("Generation failed:", err);
      }
      setIsGenerating(false);
    },
    [activeSectionId, id, loadDraft]
  );

  const handleSelectModel = useCallback(
    async (source: "a" | "b") => {
      if (!activeSectionId) return;
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedSource: source }),
        }
      );
      if (res.ok) await loadDraft();
    },
    [activeSectionId, id, loadDraft]
  );

  const handleMerge = useCallback(async () => {
    if (!activeSectionId || !draft) return;
    const section = draft.sections.find((s) => s.id === activeSectionId);
    if (!section?.contentA || !section?.contentB) return;

    const merged = `${section.contentA}\n\n---\n\n${section.contentB}`;
    const res = await fetch(
      `/api/v1/drafts/${id}/sections/${activeSectionId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: merged }),
      }
    );
    if (res.ok) await loadDraft();
  }, [activeSectionId, id, draft, loadDraft]);

  const handleConfirm = useCallback(async () => {
    if (!activeSectionId) return;
    const res = await fetch(
      `/api/v1/drafts/${id}/sections/${activeSectionId}/confirm`,
      { method: "POST" }
    );
    if (res.ok) {
      await loadDraft();
      if (draft) {
        const sections = draft.sections;
        const currentIdx = sections.findIndex((s) => s.id === activeSectionId);
        const nextPending = sections
          .slice(currentIdx + 1)
          .find(
            (s) => s.status === "pending" || s.status === "failed"
          );
        if (nextPending) setActiveSectionId(nextPending.id);
      }
    }
  }, [activeSectionId, id, draft, loadDraft]);

  const handleRegenerate = useCallback(() => {
    handleGenerate("single");
  }, [handleGenerate]);

  const handleExport = useCallback(async () => {
    const res = await fetch(`/api/v1/drafts/${id}/export`, {
      method: "POST",
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft?.title || "document"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      alert(data.error || "Export failed");
    }
  }, [id, draft]);

  const handleAssemble = useCallback(async () => {
    await fetch(`/api/v1/drafts/${id}/assemble`, { method: "POST" });
    await loadDraft();
  }, [id, loadDraft]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-[#A1A1AA]">
          <div className="w-10 h-10 mx-auto mb-3 border-3 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          <p>Loading draft...</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-[#52525B] mb-2">Draft not found</p>
          <button
            onClick={() => router.push("/writing")}
            className="text-sm text-[#4361EE] hover:underline cursor-pointer"
          >
            Back to drafts
          </button>
        </div>
      </div>
    );
  }

  const sections = draft.sections || [];
  const allCompleted = sections.length > 0 && sections.every(
    (s) => s.status === "locked" || s.status === "summarized"
  );

  return (
    <div className="min-h-screen">
      {/* Custom Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 h-16 bg-[rgba(247,246,243,0.85)] backdrop-blur-xl border-b border-[#E4E4E7]">
        <div>
          <h2 className="text-[22px] font-semibold font-display text-[#18181B]">
            Document Writing
          </h2>
          <span className="text-[13px] text-[#52525B]">{draft.title}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {allCompleted && (
            <button
              onClick={handleAssemble}
              className="px-4 py-2 border border-[#E4E4E7] rounded-xl text-sm font-medium text-[#52525B] hover:bg-[#ECECEA] transition-colors cursor-pointer"
            >
              Assemble
            </button>
          )}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 border border-[#E4E4E7] rounded-xl text-sm font-medium text-[#52525B] hover:bg-[#ECECEA] transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </header>

      {/* 3-Panel Layout */}
      <div
        className="grid h-[calc(100vh-64px)]"
        style={{ gridTemplateColumns: "260px 1fr 300px" }}
      >
        <OutlinePanel
          sections={sections}
          activeSectionId={activeSectionId}
          onSelectSection={setActiveSectionId}
        />

        <EditorPanel
          section={activeSection}
          allSections={sections}
          onGenerate={handleGenerate}
          onSelectModel={handleSelectModel}
          onMerge={handleMerge}
          onConfirm={handleConfirm}
          onRegenerate={handleRegenerate}
          isGenerating={isGenerating}
        />

        <ReferencePanel
          references={references}
          sectionNotes={sectionNotes}
          onSectionNotesChange={setSectionNotes}
        />
      </div>
    </div>
  );
}
