"use client";

import { useState, useCallback } from "react";
import type { SectionMeta, GenerationMode } from "@/types/writing";
import { StatePills } from "./state-pills";
import { ConstraintsBar } from "./constraints-bar";
import { ComparisonView } from "./comparison-view";

interface SectionConstraints {
  wordLimit: number;
  additionalRequirements: string;
  generationMode: GenerationMode;
}

interface EditorPanelProps {
  section: SectionMeta | null;
  allSections: SectionMeta[];
  models: any[];
  selectedModelA: string;
  selectedModelB: string;
  onModelAChange: (val: string) => void;
  onModelBChange: (val: string) => void;
  onGenerate: (mode: GenerationMode, constraints: SectionConstraints) => void;
  onSelectModel: (source: "a" | "b") => void;
  onMerge: () => void;
  onConfirm: () => void;
  onRegenerate: () => void;
  onHumanize: () => void;
  isGenerating: boolean;
  isHumanizing: boolean;
  streamingContent?: string;
}

export function EditorPanel({
  section,
  allSections,
  models,
  selectedModelA,
  selectedModelB,
  onModelAChange,
  onModelBChange,
  onGenerate,
  onSelectModel,
  onMerge,
  onConfirm,
  onRegenerate,
  onHumanize,
  isGenerating,
  isHumanizing,
  streamingContent = "",
}: EditorPanelProps) {
  const [generationMode, setGenerationMode] = useState<GenerationMode>("single");
  const [wordLimit, setWordLimit] = useState(800);
  const [additionalRequirements, setAdditionalRequirements] = useState("");
  const [editingContent, setEditingContent] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    onGenerate(generationMode, { wordLimit, additionalRequirements, generationMode });
  }, [generationMode, wordLimit, additionalRequirements, onGenerate]);

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
  const isLocked = section.status === "locked" || section.status === "summarized";

  const modelAName = section.modelA || "Model A";
  const modelBName = section.modelB || "Model B";

  return (
    <div className="p-6 overflow-y-auto bg-slate-50/50 h-full">
      {/* Section Header */}
      <div className="mb-5">
        <h2 className="text-[22px] font-bold text-slate-900 mb-1">
          {section.index + 1}. {section.title}
        </h2>
        <span className="text-[13px] text-slate-500 font-medium">
          {section.estimatedWords ? `Estimated ~${section.estimatedWords} words` : "No word estimate"}
          {section.description && ` — ${section.description}`}
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
        />
      )}

      {/* Content Display */}
      {isLocked && section.content && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-[15px] leading-loose text-slate-700">
            {section.content.split("\n\n").map((p, i) => (
              <p key={i} className="mb-3">{p}</p>
            ))}
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
                onSelectModel("a");
                setEditingContent(null);
              }}
              className="px-4 py-1.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors cursor-pointer shadow-sm"
            >
              Save Edit
            </button>
          </div>
        </div>
      )}

      {(isComparing || isReviewing) && editingContent === null && (
        <ComparisonView
          contentA={section.contentA || section.content}
          contentB={section.contentB}
          modelAName={modelAName}
          modelBName={modelBName}
          onSelectA={() => onSelectModel("a")}
          onSelectB={() => onSelectModel("b")}
          onMerge={onMerge}
          onEdit={handleEdit}
          mode={isComparing && section.contentB ? "compare" : "single"}
        />
      )}

      {/* Action Bar — only show when content is available */}
      {canConfirm && editingContent === null && (
        <div className="flex items-center justify-between mt-5 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="flex gap-2.5">
            {isComparing && section.contentB && (
              <>
                <button
                  onClick={() => onSelectModel("a")}
                  className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-emerald-500 text-emerald-600 bg-transparent rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Select A
                </button>
                <button
                  onClick={() => onSelectModel("b")}
                  className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-blue-500 text-blue-600 bg-transparent rounded-xl text-sm font-semibold hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Select B
                </button>
                <button
                  onClick={onMerge}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                  Merge Both
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Regenerate
            </button>
            <button
              onClick={onHumanize}
              disabled={isHumanizing}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-primary-500 text-primary-600 bg-transparent rounded-xl text-sm font-semibold hover:bg-primary-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isHumanizing ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <path d="M12 12l7-7" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
              {isHumanizing ? "Humanizing..." : "Humanize"}
            </button>
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Confirm Section
            </button>
          </div>
        </div>
      )}

      {/* Generating state or Streaming Content */}
      {isGenerating && streamingContent === "" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
          <div className="w-10 h-10 mx-auto mb-3 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500">Starting generation...</p>
        </div>
      )}
      
      {isGenerating && streamingContent !== "" && (
        <div className="bg-white border border-primary-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-primary-100">
            <div className="h-full bg-primary-500 animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2 mb-3 border-b border-slate-100 pb-3">
            <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse"></div>
            <span className="text-xs font-semibold text-primary-600 uppercase tracking-wider">Generating</span>
          </div>
          <div className="text-[15px] leading-loose text-slate-700 whitespace-pre-wrap">
            {streamingContent}
            <span className="inline-block w-1.5 h-4 ml-1 bg-primary-500 animate-pulse translate-y-0.5"></span>
          </div>
        </div>
      )}
    </div>
  );
}
