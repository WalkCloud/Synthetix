"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { OutlinePanel } from "@/components/writing/outline-panel";
import { EditorPanel } from "@/components/writing/editor-panel";
import { ReferencePanel } from "@/components/writing/reference-panel";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { DraftMeta, SectionMeta, GenerationMode } from "@/types/writing";
import { isSectionDone } from "@/types/writing";

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

interface SectionAssetItem {
  id: string;
  type: string;
  title: string;
  status: string;
  mimeType?: string | null;
  prompt?: string | null;
}

interface GenerateAllTask {
  id: string;
  type: string;
  status: string;
  progress: number;
  result?: {
    generated?: number;
    total?: number;
    currentSectionId?: string | null;
    currentSectionTitle?: string | null;
  } | null;
  error?: string | null;
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
  const [generatingSectionId, setGeneratingSectionId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [exportFormat, setExportFormat] = useState<"markdown" | "pdf" | "docx">("markdown");
  const [loading, setLoading] = useState(true);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(260);
  const [referenceWidth, setReferenceWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sectionAssets, setSectionAssets] = useState<SectionAssetItem[]>([]);
  const [generateAllTaskId, setGenerateAllTaskId] = useState<string | null>(null);
  const [generateAllTask, setGenerateAllTask] = useState<GenerateAllTask | null>(null);
  const [isStartingGenerateAll, setIsStartingGenerateAll] = useState(false);
  const [isCancellingGenerateAll, setIsCancellingGenerateAll] = useState(false);
  
  // Model selection states
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelA, setSelectedModelA] = useState<string>("");
  const [selectedModelB, setSelectedModelB] = useState<string>("");

  const activeSection = draft?.sections.find((s) => s.id === activeSectionId) || null;

  const loadAssets = useCallback(async () => {
    if (!activeSectionId) { setSectionAssets([]); return; }
    try {
      const res = await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}/assets`);
      const data = await res.json();
      if (data.success) {
        setSectionAssets(
          (data.data || []).map((a: any) => ({
            id: a.id,
            type: a.type,
            title: a.title,
            status: a.status,
            mimeType: a.mimeType,
            prompt: a.prompt,
          }))
        );
      }
    } catch {}
  }, [id, activeSectionId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  useEffect(() => {
    if (!draft || !activeSectionId) {
      setReferences([]);
      return;
    }
    const section = draft.sections?.find((s) => s.id === activeSectionId);
    if (section?.references?.length) {
      setReferences(
        section.references.map((ref) => ({
          documentName: ref.documentName,
          content: ref.content || "",
          score: ref.relevanceScore,
          title: ref.sourceAnchor,
        }))
      );
    } else {
      setReferences([]);
    }
  }, [activeSectionId, draft]);

  const loadDraft = useCallback(async () => {
    const res = await fetch(`/api/v1/drafts/${id}`);
    const data = await res.json();
    if (data.success) {
      setDraft(data.data);
      setActiveSectionId((prev) => {
        if (prev) return prev;
        if (data.data.sections.length > 0) {
          const firstPending = data.data.sections.find(
            (s: SectionMeta) => !isSectionDone(s.status)
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

  useEffect(() => {
    let stopped = false;
    async function findRunningFullDraftTask() {
      try {
        const res = await fetch("/api/v1/tasks?status=pending,running&limit=50");
        const data = await res.json();
        if (!data.success || stopped) return;
        const task = (data.data || []).find(
          (item: GenerateAllTask & { draftId?: string | null }) =>
            item.type === "draft_generate_all" && item.draftId === id,
        );
        if (task) {
          setGenerateAllTaskId(task.id);
          setGenerateAllTask(task);
          if (task.result?.currentSectionId) {
            setActiveSectionId(task.result.currentSectionId);
          }
        }
      } catch {}
    }
    findRunningFullDraftTask();
    return () => { stopped = true; };
  }, [id]);

  useEffect(() => {
    if (!generateAllTaskId) return;

    let stopped = false;
    async function pollTask() {
      try {
        const res = await fetch(`/api/v1/tasks/${generateAllTaskId}`);
        const data = await res.json();
        if (!data.success || stopped) return;
        const task = data.data as GenerateAllTask;
        setGenerateAllTask(task);
        if (task.result?.currentSectionId) {
          setActiveSectionId(task.result.currentSectionId);
        }
        await loadDraft();
        if (["completed", "failed", "cancelled"].includes(task.status)) {
          setGenerateAllTaskId(null);
        }
      } catch {}
    }

    pollTask();
    const interval = setInterval(pollTask, 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [generateAllTaskId, loadDraft]);

  useEffect(() => {
    if (!draft) return;
    const hasServerGenerating = draft.sections.some(
      (s) => (s.status === "generating" || s.status === "retrieving") && !isGenerating
    );
    if (!hasServerGenerating) return;
    const interval = setInterval(() => loadDraft(), 10000);
    return () => clearInterval(interval);
  }, [draft, isGenerating, loadDraft]);

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const allModels = data.data.flatMap((p: any) => p.models || []);
          const chatModels = allModels.filter((m: any) => {
            return parseCapabilities(m.capabilities).includes("chat");
          });
          setModels(chatModels);
        }
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  const handleGenerate = useCallback(
    async (mode: GenerationMode, constraints?: { wordLimit: number; additionalRequirements: string }) => {
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
                  else if (data.type === "reasoning") {
                    setIsThinking(true);
                  } else if (data.type === "chunk") {
                    setIsThinking(false);
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
      } finally {
        setIsGenerating(false);
        setGeneratingSectionId(null);
      }
    },
    [activeSectionId, id, loadDraft, selectedModelA, selectedModelB]
  );

  const handleGenerateAll = useCallback(async () => {
    setIsStartingGenerateAll(true);
    try {
      const res = await fetch(`/api/v1/drafts/${id}/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overwrite: false,
          stopOnError: true,
          modelConfigId: selectedModelA && selectedModelA !== "auto" ? selectedModelA : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Failed to start full draft generation");
        return;
      }
      setGenerateAllTaskId(data.data.taskId);
      setGenerateAllTask({
        id: data.data.taskId,
        type: "draft_generate_all",
        status: data.data.status || "pending",
        progress: data.data.progress ?? 0,
      });
      await loadDraft();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to start full draft generation");
    } finally {
      setIsStartingGenerateAll(false);
    }
  }, [id, loadDraft, selectedModelA]);

  const handleCancelGenerateAll = useCallback(async () => {
    if (!generateAllTaskId) return;
    setIsCancellingGenerateAll(true);
    try {
      const res = await fetch(`/api/v1/tasks/${generateAllTaskId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        alert(data?.error || "Failed to stop full draft generation");
        return;
      }
      setGenerateAllTask((prev) =>
        prev ? { ...prev, status: "cancelled" } : prev
      );
      await loadDraft();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to stop full draft generation");
    } finally {
      setIsCancellingGenerateAll(false);
    }
  }, [generateAllTaskId, loadDraft]);

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

  const handleConfirm = useCallback(async () => {
    if (!activeSectionId) return;
    setIsConfirming(true);
    setStreamingContent("");
    setIsThinking(false);
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/confirm`,
        { method: "POST" }
      );
      if (res.ok) {
        // Fetch fresh draft data and use it directly (avoid stale closure)
        const refresh = await fetch(`/api/v1/drafts/${id}`);
        const data = await refresh.json();
        if (data.success) {
          const freshSections: SectionMeta[] = data.data.sections;
          setDraft(data.data);
          const currentIdx = freshSections.findIndex((s) => s.id === activeSectionId);
          const nextPending = freshSections
            .slice(currentIdx + 1)
            .find(
              (s) => s.status === "pending" || s.status === "failed"
            );
          if (nextPending) {
            setActiveSectionId(nextPending.id);
          }
        }
      }
    } finally {
      setIsConfirming(false);
    }
  }, [activeSectionId, id]);

  const handleUnlock = useCallback(async (targetStatus?: "reviewing" | "pending") => {
    if (!activeSectionId) return;
    try {
      const res = await fetch(
        `/api/v1/drafts/${id}/sections/${activeSectionId}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetStatus: targetStatus || "reviewing" }),
        }
      );
      if (res.ok) await loadDraft();
    } catch {}
  }, [activeSectionId, id, loadDraft]);

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
      const ext = fmt === "docx" ? ".docx" : fmt === "pdf" ? ".pdf" : ".md";
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

  const handleInsertAsset = useCallback(async (assetId: string) => {
    if (!activeSectionId || !activeSection) return;
    const current = activeSection.content || "";
    const marker = `\n[IMAGE:${assetId}]\n`;
    const updated = current + marker;
    try {
      await fetch(`/api/v1/drafts/${id}/sections/${activeSectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: updated }),
      });
      await loadDraft();
    } catch {}
  }, [id, activeSectionId, activeSection, loadDraft]);

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
  const completedSections = sections.filter((s) => isSectionDone(s.status)).length;
  const totalSections = sections.length;
  const draftProgressPercent = totalSections > 0
    ? Math.round((completedSections / totalSections) * 100)
    : 0;
  const allCompleted = totalSections > 0 && completedSections === totalSections;
  const isGenerateAllRunning =
    generateAllTask?.status === "pending" || generateAllTask?.status === "running";
  const fullDraftCurrent = generateAllTask?.result?.currentSectionTitle;

  return (
    <div className="min-h-screen">
      {/* Custom Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-8 h-16 bg-white/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOutlineCollapsed(!outlineCollapsed)}
            className={`p-2 rounded-xl border transition-colors cursor-pointer ${
              outlineCollapsed
                ? "bg-secondary border-border text-muted-foreground hover:text-foreground"
                : "bg-primary-50 border-primary/20 text-primary"
            }`}
            title={outlineCollapsed ? "Expand Outline" : "Collapse Outline"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              {outlineCollapsed ? (
                <polyline points="13 8 17 12 13 16" />
              ) : (
                <polyline points="15 8 11 12 15 16" />
              )}
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-bold font-display tracking-tight text-slate-800">
              Document Writing
            </h2>
            <span className="text-xs font-medium text-muted-foreground mt-0.5 block">{draft.title}</span>
          </div>
        </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleGenerateAll}
              disabled={isGenerateAllRunning || isStartingGenerateAll || isGenerating || allCompleted}
              className="flex items-center gap-1.5 px-4 py-2 border border-primary-200 rounded-xl text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generate all pending sections as a reviewable first draft"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 ${isStartingGenerateAll ? "animate-spin" : ""}`}>
                <path d="M12 3v3" />
                <path d="M12 18v3" />
                <path d="m4.22 4.22 2.12 2.12" />
                <path d="m17.66 17.66 2.12 2.12" />
                <path d="M3 12h3" />
                <path d="M18 12h3" />
                <path d="m4.22 19.78 2.12-2.12" />
                <path d="m17.66 6.34 2.12-2.12" />
              </svg>
              {isGenerateAllRunning
                ? "Generating..."
                : isStartingGenerateAll
                  ? "Starting..."
                  : "Generate Full Draft"}
            </button>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "markdown" | "pdf" | "docx")}
              className="px-3 py-2 border border-border rounded-xl text-xs font-medium text-foreground bg-white cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-sm"
            >
              <option value="markdown">Markdown (.md)</option>
              <option value="pdf">PDF (.pdf)</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <button
              onClick={() => handleExport(exportFormat)}
              className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-xs font-semibold text-foreground bg-white hover:bg-secondary transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
            <button
              onClick={() => setReferenceCollapsed(!referenceCollapsed)}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                referenceCollapsed
                  ? "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  : "bg-primary-50 border-primary/20 text-primary"
              }`}
              title={referenceCollapsed ? "Expand Reference Panel" : "Collapse Reference Panel"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
                {referenceCollapsed ? (
                  <polyline points="11 8 7 12 11 16" />
                ) : (
                  <polyline points="9 8 13 12 9 16" />
                )}
              </svg>
            </button>
          </div>
      </header>

      {generateAllTask && (
        <div className="sticky top-16 z-10 border-b border-primary-100 bg-white/95 px-8 py-3 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    generateAllTask.status === "failed"
                      ? "bg-red-500"
                      : generateAllTask.status === "completed"
                        ? "bg-emerald-500"
                        : generateAllTask.status === "cancelled"
                          ? "bg-amber-500"
                          : "bg-primary-500 animate-pulse"
                  }`} />
                  <span className="shrink-0 text-sm font-semibold text-slate-800">
                    {isGenerateAllRunning
                      ? "Full draft running"
                      : generateAllTask.status === "completed"
                        ? "Full draft ready for review"
                        : generateAllTask.status === "cancelled"
                          ? "Full draft stopped"
                          : "Full draft failed"}
                  </span>
                  <span className="truncate text-sm text-slate-500">
                    {isGenerateAllRunning && fullDraftCurrent
                      ? `Current: ${fullDraftCurrent}`
                      : generateAllTask.error || "Review generated sections before confirming them."}
                  </span>
                </div>
                <div className="shrink-0 text-xs font-semibold text-slate-500">
                  {totalSections > 0
                    ? `${completedSections}/${totalSections} sections · ${draftProgressPercent}%`
                    : `${generateAllTask.progress}%`}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    generateAllTask.status === "failed"
                      ? "bg-red-500"
                      : generateAllTask.status === "completed"
                        ? "bg-emerald-500"
                        : generateAllTask.status === "cancelled"
                          ? "bg-amber-500"
                          : "bg-primary-600"
                  }`}
                  style={{ width: `${Math.max(isGenerateAllRunning ? 4 : 0, draftProgressPercent)}%` }}
                />
              </div>
            </div>

            {isGenerateAllRunning && (
              <button
                onClick={handleCancelGenerateAll}
                disabled={isCancellingGenerateAll}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Stop after the current in-flight model call returns"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
                {isCancellingGenerateAll ? "Stopping..." : "Stop"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3-Panel Layout */}
      <div
        ref={containerRef}
        className="flex"
        style={{
          height: generateAllTask ? "calc(100vh - 121px)" : "calc(100vh - 64px)",
        }}
      >
        {/* Outline Panel */}
        <div
          className="shrink-0 overflow-hidden border-r border-border h-full"
          style={{ width: outlineCollapsed ? 0 : outlineWidth }}
        >
          {!outlineCollapsed && (
            <div style={{ width: outlineWidth }} className="h-full">
              <OutlinePanel
                sections={sections}
                draftId={draft.id}
                draftOutline={draft.outline}
                activeSectionId={activeSectionId}
                onSelectSection={setActiveSectionId}
                onSectionsChanged={loadDraft}
              />
            </div>
          )}
        </div>

        {/* Left divider (outline | editor) */}
        {!outlineCollapsed && (
          <div
            className="shrink-0 w-1 cursor-col-resize hover:bg-primary-300 active:bg-primary-400 transition-colors relative group"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = outlineWidth;
              const onMove = (ev: MouseEvent) => {
                const delta = ev.clientX - startX;
                const next = Math.max(180, Math.min(500, startWidth + delta));
                setOutlineWidth(next);
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Editor Panel */}
        <div className="min-w-0 flex-1 h-full">
          <EditorPanel
            section={activeSection}
            allSections={sections}
            draftOutline={draft.outline}
            models={models}
            selectedModelA={selectedModelA}
            selectedModelB={selectedModelB}
            onModelAChange={setSelectedModelA}
            onModelBChange={setSelectedModelB}
            onGenerate={handleGenerate}
            onSelectModel={handleSelectModel}
            onConfirm={handleConfirm}
            onHumanize={handleHumanize}
            onUnlock={handleUnlock}
            onSaveEdit={handleSaveEdit}
            onSaveEstimatedWords={handleSaveEstimatedWords}
            isGenerating={isGenerating && generatingSectionId === activeSectionId}
            isThinking={isThinking && generatingSectionId === activeSectionId}
            isHumanizing={isHumanizing}
            isConfirming={isConfirming}
            streamingContent={generatingSectionId === activeSectionId ? streamingContent : ""}
            assetRenderVer={sectionAssets[0]?.prompt?.length ?? sectionAssets.length}
          />
        </div>

        {/* Right divider (editor | reference) */}
        {!referenceCollapsed && (
          <div
            className="shrink-0 w-1 cursor-col-resize hover:bg-primary-300 active:bg-primary-400 transition-colors relative group"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = referenceWidth;
              const onMove = (ev: MouseEvent) => {
                const delta = startX - ev.clientX;
                const next = Math.max(200, Math.min(600, startWidth + delta));
                setReferenceWidth(next);
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Reference Panel */}
        <div
          className="shrink-0 overflow-hidden border-l border-border h-full"
          style={{ width: referenceCollapsed ? 0 : referenceWidth }}
        >
          {!referenceCollapsed && (
            <div style={{ width: referenceWidth }} className="h-full">
              <ReferencePanel
                references={references}
                sectionNotes={sectionNotes}
                onSectionNotesChange={setSectionNotes}
                draftId={id}
                sectionId={activeSectionId}
                sectionContent={activeSection?.content || ""}
                sectionRagMode={activeSection?.ragMode || "auto"}
                sectionRagDocumentIds={(() => { try { return JSON.parse(activeSection?.ragDocumentIds || "[]"); } catch { return []; } })()}
                assets={sectionAssets}
                onAssetChanged={loadAssets}
                onRagConfigChange={handleRagConfigChange}
                onInsertAsset={handleInsertAsset}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
