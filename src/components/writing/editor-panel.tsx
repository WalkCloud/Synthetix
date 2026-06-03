"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SectionMeta, GenerationMode, ModelOption } from "@/types/writing";
import { isSectionDone } from "@/lib/writing/status";
import { getOutlineNumber } from "@/lib/writing/outline-utils";
import { countWords } from "@/lib/text/count-words";
import { StatePills } from "./state-pills";
import { ConstraintsBar } from "./constraints-bar";
import { ComparisonView } from "./comparison-view";
import { ContentRenderer } from "./content-renderer";
import { Spinner } from "@/components/shared/spinner";
import { useLocale } from "@/lib/i18n";

interface SectionConstraints {
  wordLimit: number;
  additionalRequirements: string;
  generationMode: GenerationMode;
}

interface EditorPanelProps {
  section: SectionMeta | null;
  allSections: SectionMeta[];
  draftOutline: string;
  models: ModelOption[];
  selectedModelA: string;
  selectedModelB: string;
  onModelAChange: (id: string) => void;
  onModelBChange: (id: string) => void;
  onGenerate: (mode: GenerationMode, constraints: { wordLimit: number; additionalRequirements: string; generationMode: GenerationMode }) => Promise<void>;
  onSelectModel: (source: "a" | "b") => Promise<void>;
  onConfirm: () => void;
  onHumanize: () => void;
  onUnlock: (status?: "reviewing" | "pending") => Promise<void>;
  onSaveEdit: (content: string) => void;
  onSaveEstimatedWords?: (words: number) => void;
  isGenerating: boolean;
  isThinking: boolean;
  isHumanizing: boolean;
  isConfirming: boolean;
  streamingContent?: string;
  streamContentA?: string;
  streamContentB?: string;
  genMode?: GenerationMode;
  onMarkerClick?: (markerId: string, kind: "image" | "diagram") => void;
  pendingMarkerCount?: number;
}

export function EditorPanel({
  section,
  allSections,
  draftOutline,
  models,
  selectedModelA,
  selectedModelB,
  onModelAChange,
  onModelBChange,
  onGenerate,
  onSelectModel,
  onConfirm,
  onHumanize,
  onUnlock,
  onSaveEdit,
  onSaveEstimatedWords,
  isGenerating,
  isThinking,
  isHumanizing,
  isConfirming,
  streamingContent = "",
  streamContentA = "",
  streamContentB = "",
  genMode = "single",
  onMarkerClick,
  pendingMarkerCount = 0,
}: EditorPanelProps) {
  const { locale, t } = useLocale();
  const isZh = locale === "zh-CN";
  const [generationMode, setGenerationMode] = useState<GenerationMode>("single");
  const [wordLimit, setWordLimit] = useState(800);
  const [additionalRequirements, setAdditionalRequirements] = useState("");
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [displayedContent, setDisplayedContent] = useState("");
  const typingRef = useRef<number | null>(null);
  const targetRef = useRef("");

  const [displayContentA, setDisplayContentA] = useState("");
  const [displayContentB, setDisplayContentB] = useState("");
  const typingRefA = useRef<number | null>(null);
  const typingRefB = useRef<number | null>(null);
  const targetRefA = useRef("");
  const targetRefB = useRef("");

  // Update wordLimit when section changes
  useEffect(() => {
    if (section?.estimatedWords) {
      setWordLimit(section.estimatedWords);
    }
  }, [section?.estimatedWords]);

  useEffect(() => {
    if (!isGenerating || !streamingContent) {
      targetRef.current = "";
      setDisplayedContent("");
      if (typingRef.current) {
        cancelAnimationFrame(typingRef.current);
        typingRef.current = null;
      }
      return;
    }

    targetRef.current = streamingContent;

    if (typingRef.current) return;

    let lastIdx = 0;
    const tick = () => {
      setDisplayedContent((prev) => {
        const target = targetRef.current;
        if (prev.length >= target.length) {
          typingRef.current = null;
          return prev;
        }
        const step = Math.max(1, Math.ceil((target.length - prev.length) / 8));
        const next = target.slice(0, Math.min(prev.length + step, target.length));
        lastIdx = next.length;
        return next;
      });
      typingRef.current = requestAnimationFrame(tick);
    };
    typingRef.current = requestAnimationFrame(tick);

    return () => {
      if (typingRef.current) {
        cancelAnimationFrame(typingRef.current);
        typingRef.current = null;
      }
    };
  }, [isGenerating, streamingContent]);

  const isCompareStreaming = genMode === "compare" && isGenerating;

  useEffect(() => {
    if (!isCompareStreaming || !streamContentA) {
      targetRefA.current = "";
      setDisplayContentA("");
      if (typingRefA.current) {
        cancelAnimationFrame(typingRefA.current);
        typingRefA.current = null;
      }
      return;
    }
    targetRefA.current = streamContentA;
    if (typingRefA.current) return;
    const tick = () => {
      setDisplayContentA((prev) => {
        const target = targetRefA.current;
        if (prev.length >= target.length) { typingRefA.current = null; return prev; }
        const step = Math.max(1, Math.ceil((target.length - prev.length) / 8));
        return target.slice(0, Math.min(prev.length + step, target.length));
      });
      typingRefA.current = requestAnimationFrame(tick);
    };
    typingRefA.current = requestAnimationFrame(tick);
    return () => {
      if (typingRefA.current) { cancelAnimationFrame(typingRefA.current); typingRefA.current = null; }
    };
  }, [isCompareStreaming, streamContentA]);

  useEffect(() => {
    if (!isCompareStreaming || !streamContentB) {
      targetRefB.current = "";
      setDisplayContentB("");
      if (typingRefB.current) {
        cancelAnimationFrame(typingRefB.current);
        typingRefB.current = null;
      }
      return;
    }
    targetRefB.current = streamContentB;
    if (typingRefB.current) return;
    const tick = () => {
      setDisplayContentB((prev) => {
        const target = targetRefB.current;
        if (prev.length >= target.length) { typingRefB.current = null; return prev; }
        const step = Math.max(1, Math.ceil((target.length - prev.length) / 8));
        return target.slice(0, Math.min(prev.length + step, target.length));
      });
      typingRefB.current = requestAnimationFrame(tick);
    };
    typingRefB.current = requestAnimationFrame(tick);
    return () => {
      if (typingRefB.current) { cancelAnimationFrame(typingRefB.current); typingRefB.current = null; }
    };
  }, [isCompareStreaming, streamContentB]);

  const handleGenerate = useCallback(() => {
    onSaveEstimatedWords?.(wordLimit);
    onGenerate(generationMode, { wordLimit, additionalRequirements, generationMode });
  }, [generationMode, wordLimit, additionalRequirements, onGenerate, onSaveEstimatedWords]);

  const handleEdit = useCallback((content: string, _source: "a" | "b") => {
    setEditingContent(content);
  }, []);

  if (!section) {
    return (
      <div className="p-6 overflow-y-auto bg-muted/40 h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium mb-1">{isZh ? "选择一个章节" : "Select a section"}</p>
          <p className="text-sm">{isZh ? "从大纲中选择章节后开始写作。" : "Choose a section from the outline to start writing."}</p>
        </div>
      </div>
    );
  }

  const isComparing = section.status === "comparing";
  const isReviewing = section.status === "reviewing";
  const canGenerate = section.status === "pending" || section.status === "failed";
  const canConfirm = isReviewing || section.status === "comparing";
  const isLocked = isSectionDone(section.status);
  const isServerGenerating = !isGenerating && (section.status === "generating" || section.status === "retrieving");

  const modelAName = section.modelA || `${t.models.usage.model} A`;
  const modelBName = section.modelB || `${t.models.usage.model} B`;

  return (
    <div className="p-6 overflow-y-auto bg-muted/40 h-full">
      {/* Section Header */}
      <div className="mb-5">
        <h2 className="text-[22px] font-bold text-foreground mb-1">
          {getOutlineNumber(section, draftOutline)}. {section.title}
        </h2>
        <span className="text-[13px] text-muted-foreground font-medium">
          {section.estimatedWords ? (isZh ? `预计约 ${section.estimatedWords} 字` : `Estimated ~${section.estimatedWords} words`) : (isZh ? "未设置字数预估" : "No word estimate")}
          {section.description && ` — ${section.description}`}
          {pendingMarkerCount > 0 && (
            <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full text-[11px] font-semibold">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M2 6h12M6 2v12" />
              </svg>
              {pendingMarkerCount} {isZh ? "待处理" : "pending"}
            </span>
          )}
        </span>
      </div>

      {/* State Pills */}
      <StatePills status={section.status} />

      {/* Constraints Bar — only show for pending/failed */}
      {canGenerate && (
        <ConstraintsBar
          sections={allSections}
          generationMode={generationMode}
          wordLimit={wordLimit}
          additionalRequirements={additionalRequirements}
          estimatedWords={section.estimatedWords}
          models={models}
          selectedModelA={selectedModelA}
          selectedModelB={selectedModelB}
          onGenerationModeChange={setGenerationMode}
          onWordLimitChange={setWordLimit}
          onAdditionalRequirementsChange={setAdditionalRequirements}
          onModelAChange={onModelAChange}
          onModelBChange={onModelBChange}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          onSaveWordLimit={onSaveEstimatedWords}
        />
      )}

      {/* Content Display */}
          {editingContent === null && isLocked && section.content && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-5 text-[15px] leading-loose text-foreground/75">
                <ContentRenderer
                  content={section.content}
                  draftId={section.draftId}
                  sectionId={section.id}
                  sectionTitle={section.title}
                  onMarkerClick={onMarkerClick}
                />
              </div>
              <div className="px-[18px] py-3 border-t border-border bg-muted/40 flex items-center justify-between">
                <span className="text-[13px] text-muted-foreground font-medium">
                  {countWords(section.content)} {isZh ? "字" : "words"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { onUnlock(); setEditingContent(section.content || ""); }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-border text-muted-foreground rounded-lg text-xs font-semibold hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                    {t.common.actions.edit}
                  </button>
                  <button
                    onClick={() => onUnlock("pending")}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-primary-200 text-primary-600 rounded-lg text-xs font-semibold hover:bg-primary-50 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    {t.writing.sections.regenerate}
                  </button>
                </div>
              </div>
            </div>
          )}

      {isServerGenerating && (
        <div className="bg-card border border-primary-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <Spinner size="lg" className="text-primary-600" style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {section.status === "retrieving" ? (isZh ? "正在检索参考资料..." : "Retrieving references...") : (isZh ? "正在生成..." : "Generation in progress...")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isZh ? "该章节正在处理中。" : "This section is being processed."}
                </p>
              </div>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 animate-[progress-indeterminate_2s_ease-in-out_infinite] rounded-full" style={{ width: "30%" }} />
            </div>
          </div>
        </div>
      )}

      {editingContent !== null && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-[18px] py-3.5 border-b border-border bg-muted/50 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">{t.writing.sections.editing}</h4>
            <button
              onClick={() => setEditingContent(null)}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              {t.common.actions.cancel}
            </button>
          </div>
          <textarea
            className="w-full p-5 text-[15px] leading-loose text-foreground/75 focus:outline-none resize-none bg-transparent"
            style={{ minHeight: "300px" }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
          />
          <div className="flex justify-end px-[18px] py-3 border-t border-border bg-muted/40">
            <button
              onClick={() => {
                onSaveEdit?.(editingContent);
                setEditingContent(null);
              }}
              className="px-4 py-1.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors cursor-pointer shadow-sm"
            >
              {isZh ? "保存编辑" : "Save Edit"}
            </button>
          </div>
        </div>
      )}

      {(isComparing || isReviewing) && editingContent === null && !isGenerating && (
        <ComparisonView
          contentA={section.contentA || section.content}
          contentB={section.contentB}
          modelAName={modelAName}
          modelBName={modelBName}
          modelA={section.modelA}
          modelB={section.modelB}
          selectedModel={section.selectedModel}
          onSelectA={() => onSelectModel("a")}
          onSelectB={() => onSelectModel("b")}
          onEdit={handleEdit}
          draftId={section.draftId}
          sectionId={section.id}
          sectionTitle={section.title}
          mode={isComparing && section.contentB ? "compare" : "single"}
        />
      )}

      {/* Action Bar — only show when content is available and not generating */}
      {canConfirm && editingContent === null && !isGenerating && (
        <div className="flex items-center justify-end gap-3 mt-5">
          <button
            onClick={() => onUnlock("pending")}
            disabled={isConfirming}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t.writing.sections.regenerate}
          </button>
          <button
            onClick={onHumanize}
            disabled={isHumanizing || isConfirming}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-primary-200 text-primary-600 rounded-xl text-sm font-medium hover:bg-primary-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isHumanizing ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            )}
            {isHumanizing ? (isZh ? "润色中..." : "Humanizing...") : t.writing.humanize.title}
          </button>
          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer shadow-sm ${
              isConfirming
                ? "bg-primary-400 text-white cursor-not-allowed"
                : "bg-primary-600 text-white hover:bg-primary-700"
            }`}
          >
            {isConfirming ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {isConfirming ? (isZh ? "确认中..." : "Confirming...") : (isZh ? "确认章节" : "Confirm Section")}
          </button>
        </div>
      )}

      {isGenerating && !streamingContent && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <Spinner size="lg" className="text-primary-600" style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {isThinking ? (isZh ? "AI 正在思考..." : "AI is thinking...") : (isZh ? "正在准备生成..." : "Preparing generation...")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isThinking ? (isZh ? "正在推理内容结构" : "Reasoning through the content structure") : (isZh ? "正在检索参考资料并构建上下文" : "Searching references & building context")}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1.5">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors duration-500 ${
                  !isThinking ? "bg-primary-100 text-primary-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${!isThinking ? "bg-primary-500 animate-pulse" : "bg-emerald-500"}`} />
                  {isZh ? "检索" : "Retrieving"}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-muted-foreground self-center">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors duration-500 ${
                  isThinking ? "bg-amber-100 text-amber-700" : "bg-secondary text-muted-foreground"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? "bg-amber-500 animate-pulse" : "bg-muted"}`} />
                  {isZh ? "思考" : "Thinking"}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-muted-foreground self-center">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-secondary text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                  {isZh ? "写作" : "Writing"}
                </div>
              </div>

              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ease-out ${
                  isThinking
                    ? "bg-gradient-to-r from-primary-500 via-amber-400 to-primary-500 bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]"
                    : "bg-primary-500 animate-[progress-indeterminate_2s_ease-in-out_infinite]"
                }`} style={{ width: isThinking ? "60%" : "30%" }} />
              </div>
            </div>
          </div>

          <div className="px-5 py-3 bg-muted/60 border-t border-border">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                />
              ))}
              <span className="text-xs text-muted-foreground ml-1">{isZh ? "这可能需要 10-30 秒" : "This may take 10-30 seconds"}</span>
            </div>
          </div>
        </div>
      )}

      {isGenerating && streamingContent && (
        <div className="bg-card border border-primary-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1 bg-primary-100">
            <div className="h-full bg-gradient-to-r from-primary-400 via-primary-500 to-primary-400 bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" style={{ width: "100%" }} />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-xs font-semibold text-primary-600 uppercase tracking-wider">{isZh ? "写作中" : "Writing"}</span>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{countWords(displayedContent)} {isZh ? "字" : "words"}</span>
          </div>
          <div className="p-5 text-[15px] leading-loose text-foreground/75 whitespace-pre-wrap min-h-[200px]">
            {displayedContent}
            <span className="inline-block w-0.5 h-[18px] ml-0.5 bg-primary-500 animate-pulse translate-y-[3px]" />
          </div>
        </div>
      )}

      {isCompareStreaming && (displayContentA || displayContentB) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-card border border-emerald-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="h-1 bg-emerald-100">
              <div className="h-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400 bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" style={{ width: "100%" }} />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-emerald-600">{modelAName}</span>
              </div>
              <span className="text-xs font-medium text-muted-foreground">{countWords(displayContentA)} {isZh ? "字" : "words"}</span>
            </div>
            <div className="p-4 text-[15px] leading-loose text-foreground/75 whitespace-pre-wrap min-h-[200px]">
              {displayContentA}
              {streamContentA && <span className="inline-block w-0.5 h-[18px] ml-0.5 bg-emerald-500 animate-pulse translate-y-[3px]" />}
            </div>
          </div>
          <div className="bg-card border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="h-1 bg-blue-100">
              <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" style={{ width: "100%" }} />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-semibold text-blue-600">{modelBName}</span>
              </div>
              <span className="text-xs font-medium text-muted-foreground">{countWords(displayContentB)} {isZh ? "字" : "words"}</span>
            </div>
            <div className="p-4 text-[15px] leading-loose text-foreground/75 whitespace-pre-wrap min-h-[200px]">
              {displayContentB}
              {streamContentB && <span className="inline-block w-0.5 h-[18px] ml-0.5 bg-blue-500 animate-pulse translate-y-[3px]" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
