"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { OutlinePanel } from "@/components/writing/outline-panel";
import { EditorPanel } from "@/components/writing/editor-panel";
import { ReferencePanel } from "@/components/writing/reference-panel";
import { isSectionDone } from "@/lib/writing/status";
import { useDraftData } from "@/hooks/writing/use-draft-data";
import { useGenerateAll } from "@/hooks/writing/use-generate-all";
import { useGeneration } from "@/hooks/writing/use-generation";
import { useSectionActions } from "@/hooks/writing/use-section-actions";
import { useExport } from "@/hooks/writing/use-export";
import { useModelSelection } from "@/hooks/writing/use-model-selection";
import { parseAllMarkers } from "@/lib/writing/marker-parser";
import { useLocale } from "@/lib/i18n";

export default function WritingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { locale, t } = useLocale();
  const isZh = locale === "zh-CN";
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const { draft, activeSectionId, setActiveSectionId, loading, loadDraft } = useDraftData(id);
  const { models, selectedModelA, selectedModelB, setSelectedModelA, setSelectedModelB } = useModelSelection();
  const genAll = useGenerateAll(id, setActiveSectionId, loadDraft);
  const gen = useGeneration(id, activeSectionId, loadDraft, selectedModelA, selectedModelB);
  const { setReferences } = gen;
  const actions = useSectionActions(id, activeSectionId, loadDraft);
  const exp = useExport(id, draft?.title);

  const [sectionNotes, setSectionNotes] = useState("");
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(260);
  const [referenceWidth, setReferenceWidth] = useState(300);

  const [activeMarker, setActiveMarker] = useState<{
    markerId: string;
    kind: "image" | "diagram";
    params: Record<string, string>;
  } | null>(null);

  const activeSection = draft?.sections.find((s) => s.id === activeSectionId) || null;
  const pendingMarkerCount = activeSection?.content ? parseAllMarkers(activeSection.content).filter((m) => m.raw.includes("_REQUEST")).length : 0;

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
          images: ref.images,
        })),
      );
    } else {
      setReferences([]);
    }
  }, [activeSectionId, draft, setReferences]);

  useEffect(() => {
    if (!draft) return;
    const hasServerGenerating = draft.sections.some(
      (s) => (s.status === "generating" || s.status === "retrieving") && !gen.isGenerating,
    );
    if (!hasServerGenerating) return;
    const interval = setInterval(() => loadDraft(), 10000);
    return () => clearInterval(interval);
  }, [draft, gen.isGenerating, loadDraft]);

  const handleConfirm = useCallback(async () => {
    await gen.handleConfirm(setActiveSectionId);
  }, [gen, setActiveSectionId]);

  const handleMarkerClick = useCallback((markerId: string, kind: "image" | "diagram") => {
    if (!activeSection?.content) return;
    const markers = parseAllMarkers(activeSection.content);
    const marker = markers.find((m) => m.markerId === markerId);
    if (!marker) return;
    setActiveMarker({ markerId, kind, params: marker.params });
    if (referenceCollapsed) setReferenceCollapsed(false);
  }, [activeSection?.content, referenceCollapsed]);

  const handleAssetConfirm = useCallback(async (markerId: string, assetId: string) => {
    if (!activeSectionId) return;
    const newContent = await actions.handleInsertAsset(markerId, assetId);
    if (newContent) {
      setActiveMarker(null);
    }
  }, [activeSectionId, actions]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <div className="text-center text-muted-foreground">
          <div className="w-10 h-10 mx-auto mb-3 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">{isZh ? "正在加载草稿..." : "Loading draft..."}</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground mb-2">{t.errors.draftNotFound}</p>
          <button
            onClick={() => router.push("/writing")}
            className="text-sm font-medium text-primary-600 hover:underline cursor-pointer"
          >
            {isZh ? "返回草稿列表" : "Back to drafts"}
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
  const fullDraftCurrent = genAll.task?.result?.currentSectionTitle;

  return (
    <div className="min-h-screen">
      {/* Custom Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-8 h-16 bg-card/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOutlineCollapsed(!outlineCollapsed)}
            className={`p-2 rounded-xl border transition-colors cursor-pointer ${
              outlineCollapsed
                ? "bg-secondary border-border text-muted-foreground hover:text-foreground"
                : "bg-primary-50 border-primary/20 text-primary"
            }`}
            title={outlineCollapsed ? (isZh ? "展开大纲" : "Expand Outline") : (isZh ? "收起大纲" : "Collapse Outline")}
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
            <h2 className="text-lg font-bold font-display tracking-tight text-foreground">
              {t.writing.title}
            </h2>
            <span className="text-xs font-medium text-muted-foreground mt-0.5 block">{draft.title}</span>
          </div>
        </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => genAll.start(selectedModelA && selectedModelA !== "auto" ? selectedModelA : undefined)}
              disabled={genAll.isRunning || genAll.isStarting || gen.isGenerating || allCompleted}
              className="flex items-center gap-1.5 px-4 py-2 border border-primary-200 rounded-xl text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={isZh ? "生成所有待处理章节，作为可审阅的一版完整草稿" : "Generate all pending sections as a reviewable first draft"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 ${genAll.isStarting ? "animate-spin" : ""}`}>
                <path d="M12 3v3" />
                <path d="M12 18v3" />
                <path d="m4.22 4.22 2.12 2.12" />
                <path d="m17.66 17.66 2.12 2.12" />
                <path d="M3 12h3" />
                <path d="M18 12h3" />
                <path d="m4.22 19.78 2.12-2.12" />
                <path d="m17.66 6.34 2.12-2.12" />
              </svg>
              {genAll.isRunning
                ? (isZh ? "生成中..." : "Generating...")
                : genAll.isStarting
                  ? (isZh ? "启动中..." : "Starting...")
                  : (isZh ? "生成完整草稿" : "Generate Full Draft")}
            </button>
            <select
              value={exp.exportFormat}
              onChange={(e) => exp.setExportFormat(e.target.value as "markdown" | "pdf" | "docx")}
              className="px-3 py-2 border border-border rounded-xl text-xs font-medium text-foreground bg-card cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-sm"
            >
              <option value="markdown">Markdown (.md)</option>
              <option value="pdf">PDF (.pdf)</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <button
              onClick={() => exp.handleExport()}
              className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-xs font-semibold text-foreground bg-card hover:bg-secondary transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t.common.actions.export}
            </button>
            <button
              onClick={() => setReferenceCollapsed(!referenceCollapsed)}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                referenceCollapsed
                  ? "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  : "bg-primary-50 border-primary/20 text-primary"
              }`}
              title={referenceCollapsed ? (isZh ? "展开参考资料面板" : "Expand Reference Panel") : (isZh ? "收起参考资料面板" : "Collapse Reference Panel")}
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

      {genAll.task && (
        <div className="sticky top-16 z-10 border-b border-primary-100 bg-card/95 px-8 py-3 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    genAll.task.status === "failed"
                      ? "bg-red-500"
                      : genAll.task.status === "completed"
                        ? "bg-emerald-500"
                        : genAll.task.status === "cancelled"
                          ? "bg-amber-500"
                          : "bg-primary-500 animate-pulse"
                  }`} />
                  <span className="shrink-0 text-sm font-semibold text-foreground">
                    {genAll.isRunning
                      ? (isZh ? "完整草稿生成中" : "Full draft running")
                      : genAll.task.status === "completed"
                        ? (isZh ? "完整草稿已生成，可审阅" : "Full draft ready for review")
                        : genAll.task.status === "cancelled"
                          ? (isZh ? "完整草稿已停止" : "Full draft stopped")
                          : (isZh ? "完整草稿生成失败" : "Full draft failed")}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {genAll.isRunning && fullDraftCurrent
                      ? `${isZh ? "当前" : "Current"}: ${fullDraftCurrent}`
                      : genAll.task.error || (isZh ? "确认前请先审阅已生成章节。" : "Review generated sections before confirming them.")}
                  </span>
                </div>
                <div className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {totalSections > 0
                    ? `${completedSections}/${totalSections} ${isZh ? "章节" : "sections"} · ${draftProgressPercent}%`
                    : `${genAll.task.progress}%`}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    genAll.task.status === "failed"
                      ? "bg-red-500"
                      : genAll.task.status === "completed"
                        ? "bg-emerald-500"
                        : genAll.task.status === "cancelled"
                          ? "bg-amber-500"
                          : "bg-primary-600"
                  }`}
                  style={{ width: `${Math.max(genAll.isRunning ? 4 : 0, draftProgressPercent)}%` }}
                />
              </div>
            </div>

            {genAll.isRunning && (
              <button
                onClick={genAll.cancel}
                disabled={genAll.isCancelling}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-200 bg-card px-4 py-2 text-xs font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={isZh ? "当前正在执行的模型调用返回后停止" : "Stop after the current in-flight model call returns"}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
                {genAll.isCancelling ? (isZh ? "停止中..." : "Stopping...") : (isZh ? "停止" : "Stop")}
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
          height: genAll.task ? "calc(100vh - 121px)" : "calc(100vh - 64px)",
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
            onGenerate={gen.handleGenerate}
            onSelectModel={actions.handleSelectModel}
            onConfirm={handleConfirm}
            onHumanize={gen.handleHumanize}
            onUnlock={gen.handleUnlock}
            onSaveEdit={actions.handleSaveEdit}
            onSaveEstimatedWords={actions.handleSaveEstimatedWords}
            isGenerating={gen.isGenerating && gen.generatingSectionId === activeSectionId}
            isThinking={gen.isThinking && gen.generatingSectionId === activeSectionId}
            isHumanizing={gen.isHumanizing}
            isConfirming={gen.isConfirming}
            streamingContent={gen.generatingSectionId === activeSectionId ? gen.streamingContent : ""}
            streamContentA={gen.generatingSectionId === activeSectionId ? gen.streamContentA : ""}
            streamContentB={gen.generatingSectionId === activeSectionId ? gen.streamContentB : ""}
            genMode={gen.generationMode}
            onMarkerClick={handleMarkerClick}
            pendingMarkerCount={pendingMarkerCount}
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
                references={gen.references}
                sectionNotes={sectionNotes}
                onSectionNotesChange={setSectionNotes}
                draftId={id}
                sectionId={activeSectionId}
                sectionContent={activeSection?.content || ""}
                sectionRagMode={activeSection?.ragMode || "auto"}
                sectionRagDocumentIds={(() => { try { return JSON.parse(activeSection?.ragDocumentIds || "[]"); } catch { return []; } })()}
                assets={actions.sectionAssets}
                onAssetChanged={actions.loadAssets}
                onRagConfigChange={actions.handleRagConfigChange}
                onInsertAsset={(assetId: string) => actions.handleInsertAsset("", assetId)}
                activeMarker={activeMarker}
                onAssetConfirm={handleAssetConfirm}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
