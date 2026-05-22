"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SectionMeta, GenerationMode, ModelOption } from "@/types/writing";
import { isSectionDone } from "@/types/writing";
import { getOutlineNumber } from "@/lib/writing/outline-utils";
import { countWords } from "@/lib/text/count-words";
import { StatePills } from "./state-pills";
import { ConstraintsBar } from "./constraints-bar";
import { ComparisonView } from "./comparison-view";
import { ContentRenderer } from "./content-renderer";
import { Spinner } from "@/components/shared/spinner";

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
  assetCount?: number;
  assetRenderVer: number;
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
  assetCount = 0,
  assetRenderVer,
}: EditorPanelProps) {
  const [generationMode, setGenerationMode] = useState<GenerationMode>("single");
  const [wordLimit, setWordLimit] = useState(800);
  const [additionalRequirements, setAdditionalRequirements] = useState("");
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [displayedContent, setDisplayedContent] = useState("");
  const typingRef = useRef<number | null>(null);
  const targetRef = useRef("");

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

  const handleGenerate = useCallback(() => {
    onSaveEstimatedWords?.(wordLimit);
    onGenerate(generationMode, { wordLimit, additionalRequirements, generationMode });
  }, [generationMode, wordLimit, additionalRequirements, onGenerate, onSaveEstimatedWords]);

  const handleEdit = useCallback((content: string, _source: "a" | "b") => {
    setEditingContent(content);
  }, []);

  if (!section) {
    return (
      <div className="p-6 overflow-y-auto bg-slate-50/50 h-full flex items-center justify-center">
        <div className="text-center text-slate-400">
          <p className="text-lg font-medium mb-1">Select a section</p>
          <p className="text-sm">Choose a section from the outline to start writing.</p>
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

  const modelAName = section.modelA || "Model A";
  const modelBName = section.modelB || "Model B";

  return (
    <div className="p-6 overflow-y-auto bg-slate-50/50 h-full">
      {/* Section Header */}
      <div className="mb-5">
        <h2 className="text-[22px] font-bold text-slate-900 mb-1">
          {getOutlineNumber(section, draftOutline)}. {section.title}
        </h2>
        <span className="text-[13px] text-slate-500 font-medium">
          {section.estimatedWords ? `Estimated ~${section.estimatedWords} words` : "No word estimate"}
          {section.description && ` — ${section.description}`}
          {assetCount > 0 && (
            <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[11px] font-semibold">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M2 6h12M6 2v12" />
              </svg>
              {assetCount} diagram{assetCount > 1 ? "s" : ""}
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
          {isLocked && section.content && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-5 text-[15px] leading-loose text-slate-700">
                <ContentRenderer
                  content={section.content}
                  draftId={section.draftId}
                  sectionId={section.id}
                  sectionTitle={section.title}
                  renderVer={assetRenderVer}
                />
              </div>
              <div className="px-[18px] py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
                <span className="text-[13px] text-slate-500 font-medium">
                  {countWords(section.content)} words
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { onUnlock(); setEditingContent(section.content || ""); }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={() => onUnlock("pending")}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 border border-primary-200 text-primary-600 rounded-lg text-xs font-semibold hover:bg-primary-50 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
          )}

      {isServerGenerating && (
        <div className="bg-white border border-primary-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <Spinner size="lg" className="text-primary-600" style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {section.status === "retrieving" ? "Retrieving references..." : "Generation in progress..."}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  This section is being processed.
                </p>
              </div>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 animate-[progress-indeterminate_2s_ease-in-out_infinite] rounded-full" style={{ width: "30%" }} />
            </div>
          </div>
        </div>
      )}

      {editingContent !== null && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-[18px] py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">Editing</h4>
            <button
              onClick={() => setEditingContent(null)}
              className="text-[13px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
          <textarea
            className="w-full p-5 text-[15px] leading-loose text-slate-700 focus:outline-none resize-none bg-transparent"
            style={{ minHeight: "300px" }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
          />
          <div className="flex justify-end px-[18px] py-3 border-t border-slate-200 bg-slate-50/50">
            <button
              onClick={() => {
                onSaveEdit?.(editingContent);
                setEditingContent(null);
              }}
              className="px-4 py-1.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors cursor-pointer shadow-sm"
            >
              Save Edit
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
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Regenerate
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
            {isHumanizing ? "Humanizing..." : "Humanize"}
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
            {isConfirming ? "Confirming..." : "Confirm Section"}
          </button>
        </div>
      )}

      {isGenerating && !streamingContent && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <Spinner size="lg" className="text-primary-600" style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {isThinking ? "AI is thinking..." : "Preparing generation..."}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isThinking ? "Reasoning through the content structure" : "Searching references & building context"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1.5">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors duration-500 ${
                  !isThinking ? "bg-primary-100 text-primary-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${!isThinking ? "bg-primary-500 animate-pulse" : "bg-emerald-500"}`} />
                  Retrieving
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-slate-300 self-center">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors duration-500 ${
                  isThinking ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? "bg-amber-500 animate-pulse" : "bg-slate-300"}`} />
                  Thinking
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-slate-300 self-center">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  Writing
                </div>
              </div>

              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ease-out ${
                  isThinking
                    ? "bg-gradient-to-r from-primary-500 via-amber-400 to-primary-500 bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]"
                    : "bg-primary-500 animate-[progress-indeterminate_2s_ease-in-out_infinite]"
                }`} style={{ width: isThinking ? "60%" : "30%" }} />
              </div>
            </div>
          </div>

          <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                />
              ))}
              <span className="text-xs text-slate-400 ml-1">This may take 10–30 seconds</span>
            </div>
          </div>
        </div>
      )}

      {isGenerating && streamingContent && (
        <div className="bg-white border border-primary-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1 bg-primary-100">
            <div className="h-full bg-gradient-to-r from-primary-400 via-primary-500 to-primary-400 bg-[length:200%_100%] animate-[shimmer_1.5s_linear_infinite]" style={{ width: "100%" }} />
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-xs font-semibold text-primary-600 uppercase tracking-wider">Writing</span>
            </div>
            <span className="text-xs font-medium text-slate-500">{countWords(displayedContent)} words</span>
          </div>
          <div className="p-5 text-[15px] leading-loose text-slate-700 whitespace-pre-wrap min-h-[200px]">
            {displayedContent}
            <span className="inline-block w-0.5 h-[18px] ml-0.5 bg-primary-500 animate-pulse translate-y-[3px]" />
          </div>
        </div>
      )}
    </div>
  );
}
