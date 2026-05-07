"use client";

import type { GenerationMode, SectionMeta } from "@/types/writing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ConstraintsBarProps {
  sections: SectionMeta[];
  generationMode: GenerationMode;
  wordLimit: number;
  additionalRequirements: string;
  onGenerationModeChange: (mode: GenerationMode) => void;
  onWordLimitChange: (limit: number) => void;
  onAdditionalRequirementsChange: (req: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export function ConstraintsBar({
  sections,
  generationMode,
  wordLimit,
  additionalRequirements,
  onGenerationModeChange,
  onWordLimitChange,
  onAdditionalRequirementsChange,
  onGenerate,
  isGenerating,
}: ConstraintsBarProps) {
  return (
    <div className="flex gap-2.5 flex-wrap items-end mb-5 p-4 bg-white border border-[#E4E4E7] rounded-[16px]">
      <div className="min-w-[160px]">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] mb-1">
          Reference Section
        </label>
        <Select>
          <SelectTrigger className="w-full text-[13px]">
            <SelectValue placeholder="None">{() => 'None'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None</SelectItem>
            {sections
              .filter((s) => s.status === "locked" || s.status === "summarized")
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  Section {s.index + 1}. {s.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[100px]">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] mb-1">
          Word Limit
        </label>
        <input
          type="number"
          className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
          value={wordLimit}
          onChange={(e) => onWordLimitChange(parseInt(e.target.value) || 500)}
        />
      </div>

      <div className="min-w-[150px]">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] mb-1">
          Generation Mode
        </label>
        <Select value={generationMode} onValueChange={(v) => onGenerationModeChange(v as GenerationMode)}>
          <SelectTrigger className="w-full text-[13px]">
            <SelectValue>{(v: string | null) => v === 'compare' ? 'Compare two models' : 'Single model'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Single model</SelectItem>
            <SelectItem value="compare">Compare two models</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] mb-1">
          Additional Requirements
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
          placeholder="e.g., Include sequence diagrams..."
          value={additionalRequirements}
          onChange={(e) => onAdditionalRequirementsChange(e.target.value)}
        />
      </div>

      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className={`flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] text-white font-semibold rounded-xl text-sm hover:bg-[#3651D4] transition-colors mt-[22px] ${
          isGenerating ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        {isGenerating ? "Generating..." : "Generate"}
      </button>
    </div>
  );
}
