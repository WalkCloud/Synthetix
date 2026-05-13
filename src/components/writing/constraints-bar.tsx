"use client";

import type { GenerationMode, SectionMeta } from "@/types/writing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ConstraintsBarProps {
  sections: SectionMeta[];
  generationMode: GenerationMode;
  wordLimit: number;
  additionalRequirements: string;
  models: any[];
  selectedModelA: string;
  selectedModelB: string;
  onGenerationModeChange: (mode: GenerationMode) => void;
  onWordLimitChange: (limit: number) => void;
  onAdditionalRequirementsChange: (req: string) => void;
  onModelAChange: (val: string) => void;
  onModelBChange: (val: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export function ConstraintsBar({
  sections,
  generationMode,
  wordLimit,
  additionalRequirements,
  models,
  selectedModelA,
  selectedModelB,
  onGenerationModeChange,
  onWordLimitChange,
  onAdditionalRequirementsChange,
  onModelAChange,
  onModelBChange,
  onGenerate,
  isGenerating,
}: ConstraintsBarProps) {
  return (
    <div className="mb-5 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="flex gap-2.5 flex-wrap items-end mb-3">
        <div className="min-w-[160px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
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

        <div className="w-[100px]">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Word Limit
          </label>
          <input
            type="number"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            value={wordLimit}
            onChange={(e) => onWordLimitChange(parseInt(e.target.value) || 500)}
          />
        </div>

        <div className="min-w-[150px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
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

        {generationMode === "compare" && (
          <>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Model A
              </label>
              <Select value={selectedModelA || "auto"} onValueChange={(v) => { if (v) onModelAChange(v); }}>
                <SelectTrigger className="w-full text-[13px] bg-slate-50 focus:bg-white transition-all">
                  <SelectValue placeholder="Auto Default">
                    {selectedModelA && selectedModelA !== "auto"
                      ? models.find((m) => m.id === selectedModelA)?.modelName || selectedModelA
                      : "Auto Default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto Default</SelectItem>
                  {models.map(m => <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Model B
              </label>
              <Select value={selectedModelB || "auto"} onValueChange={(v) => { if (v) onModelBChange(v); }}>
                <SelectTrigger className="w-full text-[13px] bg-slate-50 focus:bg-white transition-all">
                  <SelectValue placeholder="Auto Default">
                    {selectedModelB && selectedModelB !== "auto"
                      ? models.find((m) => m.id === selectedModelB)?.modelName || selectedModelB
                      : "Auto Default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto Default</SelectItem>
                  {models.map(m => <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2.5 items-end">
        <div className="flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Additional Requirements
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            placeholder="e.g., Include sequence diagrams..."
            value={additionalRequirements}
            onChange={(e) => onAdditionalRequirementsChange(e.target.value)}
          />
        </div>

        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className={`flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white font-semibold rounded-xl text-sm hover:bg-primary-700 transition-colors shadow-sm ${
            isGenerating ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {isGenerating ? "Generating..." : "Generate"}
        </button>
      </div>
    </div>
  );
}
