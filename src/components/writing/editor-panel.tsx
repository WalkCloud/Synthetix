"use client";

import { useState, useCallback } from "react";
import type { SectionMeta, GenerationMode } from "@/types/writing";
import { StatePills } from "./state-pills";
import { ConstraintsBar } from "./constraints-bar";
import { ComparisonView } from "./comparison-view";

interface EditorPanelProps {
  section: SectionMeta | null;
  allSections: SectionMeta[];
  onGenerate: (mode: GenerationMode, constraints: SectionConstraints) => void;
  onSelectModel: (source: "a" | "b") => void;
  onMerge: () => void;
  onConfirm: () => void;
  onRegenerate: () => void;
  onHumanize: () => void;
  isGenerating: boolean;
  isHumanizing: boolean;
}

interface SectionConstraints {
  wordLimit: number;
  additionalRequirements: string;
  generationMode: GenerationMode;
}

export function EditorPanel({
  section,
  allSections,
  onGenerate,
  onSelectModel,
  onMerge,
  onConfirm,
  onRegenerate,
  onHumanize,
  isGenerating,
  isHumanizing,
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
      <div className="p-6 overflow-y-auto bg-[#F5F5F3] h-full flex items-center justify-center">
        <div className="text-center text-[#A1A1AA]">
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
    <div className="p-6 overflow-y-auto bg-[#F5F5F3] h-full">
      {/* Section Header */}
      <div className="mb-5">
        <h2 className="text-[22px] font-bold text-[#18181B] mb-1">
          {section.index + 1}. {section.title}
        </h2>
        <span className="text-[13px] text-[#52525B]">
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
          onGenerationModeChange={setGenerationMode}
          onWordLimitChange={setWordLimit}
          onAdditionalRequirementsChange={setAdditionalRequirements}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
        />
      )}

      {/* Content Display */}
      {isLocked && section.content && (
        <div className="bg-white border border-[#E4E4E7] rounded-[16px] p-5">
          <div className="text-sm leading-[1.8] text-[#52525B]">
            {section.content.split("\n\n").map((p, i) => (
              <p key={i} className="mb-3">{p}</p>
            ))}
          </div>
        </div>
      )}

      {editingContent !== null && (
        <div className="bg-white border border-[#E4E4E7] rounded-[16px] overflow-hidden">
          <div className="px-[18px] py-3.5 border-b border-[#E4E4E7] bg-[#F5F5F3] flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[#18181B]">Editing</h4>
            <button
              onClick={() => setEditingContent(null)}
              className="text-[13px] text-[#52525B] hover:text-[#18181B] cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <textarea
            className="w-full p-5 text-sm leading-[1.8] text-[#52525B] focus:outline-none resize-none"
            style={{ minHeight: "300px" }}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
          />
          <div className="flex justify-end px-[18px] py-3 border-t border-[#E4E4E7]">
            <button
              onClick={() => {
                onSelectModel("a");
                setEditingContent(null);
              }}
              className="px-4 py-1.5 bg-[#4361EE] text-white rounded-xl text-sm font-medium hover:bg-[#3651D4] transition-colors cursor-pointer"
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
        <div className="flex items-center justify-between mt-5 p-4 bg-white border border-[#E4E4E7] rounded-[16px]">
          <div className="flex gap-2.5">
            {isComparing && section.contentB && (
              <>
                <button
                  onClick={() => onSelectModel("a")}
                  className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#16A34A] text-[#16A34A] bg-transparent rounded-xl text-sm font-medium hover:bg-[#16A34A]/5 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Select A
                </button>
                <button
                  onClick={() => onSelectModel("b")}
                  className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#2563EB] text-[#2563EB] bg-transparent rounded-xl text-sm font-medium hover:bg-[#2563EB]/5 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Select B
                </button>
                <button
                  onClick={onMerge}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[#52525B] hover:text-[#18181B] hover:bg-[#ECECEA] rounded-xl text-sm font-medium transition-colors cursor-pointer"
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
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E4E4E7] rounded-xl text-sm font-medium text-[#52525B] hover:bg-[#ECECEA] transition-colors cursor-pointer"
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
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#7C3AED] text-[#7C3AED] bg-transparent rounded-xl text-sm font-medium hover:bg-[#7C3AED]/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#4361EE] text-white rounded-xl text-sm font-semibold hover:bg-[#3651D4] transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Confirm Section
            </button>
          </div>
        </div>
      )}

      {/* Generating state */}
      {isGenerating && (
        <div className="bg-white border border-[#E4E4E7] rounded-[16px] p-12 text-center">
          <div className="w-10 h-10 mx-auto mb-3 border-3 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#52525B]">Generating content...</p>
        </div>
      )}
    </div>
  );
}
