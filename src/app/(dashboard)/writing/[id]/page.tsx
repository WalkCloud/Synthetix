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
  const [streamingContent, setStreamingContent] = useState("");
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [exportFormat, setExportFormat] = useState<"markdown" | "pdf" | "docx">("markdown");
  const [loading, setLoading] = useState(true);
  
  // Model selection states
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelA, setSelectedModelA] = useState<string>("");
  const [selectedModelB, setSelectedModelB] = useState<string>("");

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
  }, [id, loadDraft]);

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const allModels = data.data.flatMap((p: any) => p.models || []);
          const chatModels = allModels.filter((m: any) => {
            const caps = typeof m.capabilities === "string" ? JSON.parse(m.capabilities) : (m.capabilities || []);
            return caps.includes("chat");
          });
          setModels(chatModels);
        }
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  const handleGenerate = useCallback(
    async (mode: GenerationMode, constraints?: { wordLimit: number; additionalRequirements: string }) => {
      if (!activeSectionId) return;
      setIsGenerating(true);
      setStreamingContent("");

      const endpoint =
        mode === "compare"
          ? `/api/v1/drafts/${id}/sections/${activeSectionId}/compare`
          : `/api/v1/drafts/${id}/sections/${activeSectionId}/generate`;

      const payload = {
        constraints,
        modelAConfigId: mode === "compare" && selectedModelA && selectedModelA !== "auto" ? selectedModelA : undefined,
        modelBConfigId: mode === "compare" && selectedModelB && selectedModelB !== "auto" ? selectedModelB : undefined,
      };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.headers.get("Content-Type")?.includes("text/event-stream")) {
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
                  else if (data.type === "chunk") {
                    contentBuf += data.content;
                    setStreamingContent(contentBuf);
                  } else if (data.type === "error") {
                    alert(data.error);
                  }
                } catch (e) {}
              }
            }
          }
          await loadDraft();
          setStreamingContent("");
        } else {
          const data = await res.json();
          
          if (!data.success) {
            alert(data.error || "Generation failed");
          } else if (data.data && data.data.references) {
            setReferences(data.data.references);
          }
          await loadDraft();
        }
      } catch (err) {
        console.error("Generation failed:", err);
        alert(err instanceof Error ? err.message : "Generation failed");
      }
      setIsGenerating(false);
    },
    [activeSectionId, id, loadDraft, selectedModelA, selectedModelB]
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

  const handleHumanize = useCallback(async () => {
    if (!activeSectionId) return;
    setIsHumanizing(true);
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/humanize`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Humanize failed");
      }
      await loadDraft();
    } catch (err) {
      console.error("Humanize failed:", err);
    }
    setIsHumanizing(false);
  }, [activeSectionId, id, loadDraft]);

  const handleExport = useCallback(async (format?: "markdown" | "pdf" | "docx") => {
    const fmt = format || exportFormat;
    const res = await fetch(`/api/v1/drafts/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: fmt }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = fmt === "docx" ? ".docx" : fmt === "pdf" ? ".html" : ".md";
      a.download = `${draft?.title || "document"}${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      alert(data.error || "Export failed");
    }
  }, [id, draft, exportFormat]);

  const handleAssemble = useCallback(async () => {
    await fetch(`/api/v1/drafts/${id}/assemble`, { method: "POST" });
    await loadDraft();
  }, [id, loadDraft]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
        <div className="text-center text-slate-400">
          <div className="w-10 h-10 mx-auto mb-3 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">Loading draft...</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
        <div className="text-center">
          <p className="text-lg font-medium text-slate-600 mb-2">Draft not found</p>
          <button
            onClick={() => router.push("/writing")}
            className="text-sm font-medium text-primary-600 hover:underline cursor-pointer"
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
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 h-[60px] bg-white/80 backdrop-blur-xl border-b border-slate-200">
        <div>
          <h2 className="text-[20px] font-semibold font-display text-foreground">
            Document Writing
          </h2>
          <span className="text-[13px] font-medium text-slate-500">{draft.title}</span>
        </div>
          <div className="flex items-center gap-2.5">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "markdown" | "pdf" | "docx")}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 bg-white cursor-pointer focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all shadow-sm"
            >
              <option value="markdown">Markdown (.md)</option>
              <option value="pdf">PDF (Print HTML)</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <button
              onClick={() => handleExport(exportFormat)}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
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
          models={models}
          selectedModelA={selectedModelA}
          selectedModelB={selectedModelB}
          onModelAChange={setSelectedModelA}
          onModelBChange={setSelectedModelB}
          onGenerate={handleGenerate}
          onSelectModel={handleSelectModel}
          onMerge={handleMerge}
          onConfirm={handleConfirm}
          onRegenerate={handleRegenerate}
          onHumanize={handleHumanize}
          isGenerating={isGenerating}
          isHumanizing={isHumanizing}
          streamingContent={streamingContent}
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
