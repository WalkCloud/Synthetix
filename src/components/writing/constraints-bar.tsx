"use client";

import type { GenerationMode, SectionMeta, ModelOption } from "@/types/writing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";

interface ConstraintsBarProps {
  sections: SectionMeta[];
  generationMode: GenerationMode;
  wordLimit: number;
  additionalRequirements: string;
  estimatedWords?: number | null;
  models: ModelOption[];
  selectedModelA: string;
  selectedModelB: string;
  defaultModelId: string | null;
  onGenerationModeChange: (mode: GenerationMode) => void;
  onWordLimitChange: (limit: number) => void;
  onAdditionalRequirementsChange: (req: string) => void;
  onModelAChange: (val: string) => void;
  onModelBChange: (val: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  onSaveWordLimit?: (limit: number) => void;
}

export function ConstraintsBar({
  sections,
  generationMode,
  wordLimit,
  additionalRequirements,
  estimatedWords,
  models,
  selectedModelA,
  selectedModelB,
  defaultModelId,
  onGenerationModeChange,
  onWordLimitChange,
  onAdditionalRequirementsChange,
  onModelAChange,
  onModelBChange,
  onGenerate,
  isGenerating,
  onSaveWordLimit,
}: ConstraintsBarProps) {
  const { t, format } = useLocale();
  const cx = t.writing.constraintsExtra;
  const noneLabel = t.common.states.none;
  const defaultSuffix = `（${t.models.models.isDefault}）`;
  const singleModel = cx.singleModel;
  const compareModels = cx.compareModels;

  // Builds the trigger display value for a model selector. The user's default
  // model is shown as "name（默认）"; others show just the name. If no model is
  // flagged as default, the generic "默认模型" label is used as a placeholder.
  function modelTriggerLabel(selectedId: string): string {
    const m = models.find((mo) => mo.id === selectedId);
    if (!m) return cx.autoDefault;
    if (m.id === defaultModelId) return `${m.modelName}${defaultSuffix}`;
    return m.modelName;
  }

  function ModelSelect({
    selectedId,
    onChange,
  }: {
    selectedId: string;
    onChange: (val: string) => void;
  }) {
    const value = selectedId || "auto";
    return (
      <Select value={value} onValueChange={(v) => { if (v && v !== "auto") onChange(v); }}>
        <SelectTrigger className="w-full text-[13px] bg-muted/50 focus:bg-card transition-all">
          <SelectValue placeholder={cx.autoDefault}>{modelTriggerLabel(selectedId)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {defaultModelId && (
            <SelectItem value="auto">
              {models.find((m) => m.id === defaultModelId)?.modelName}
              {defaultSuffix}
            </SelectItem>
          )}
          {models
            .filter((m) => m.id !== defaultModelId)
            .map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>
            ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="mb-5 p-4 bg-card border border-border rounded-2xl shadow-sm">
      <div className="flex gap-2.5 flex-wrap items-end mb-3">
        <div className="min-w-[160px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {cx.referenceSection}
          </label>
          <Select>
            <SelectTrigger className="w-full text-[13px]">
              <SelectValue placeholder={noneLabel}>{() => noneLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{noneLabel}</SelectItem>
              {sections
                .filter((s) => s.status === "locked" || s.status === "summarized")
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {cx.sectionLabel} {s.index + 1}. {s.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[120px]">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {cx.wordLimit}
          </label>
          <input
            type="number"
            className="w-full px-3 py-2 border border-border rounded-lg text-[13px] bg-muted/50 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            value={wordLimit}
            placeholder={estimatedWords ? format.template(cx.recommended, { n: estimatedWords }) : "500"}
            onChange={(e) => onWordLimitChange(parseInt(e.target.value) || 500)}
            onBlur={() => onSaveWordLimit?.(wordLimit)}
          />
        </div>

        <div className="min-w-[150px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {cx.generationMode}
          </label>
          <Select value={generationMode} onValueChange={(v) => onGenerationModeChange(v as GenerationMode)}>
            <SelectTrigger className="w-full text-[13px]">
              <SelectValue>{(v: string | null) => v === "compare" ? compareModels : singleModel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">{singleModel}</SelectItem>
              <SelectItem value="compare">{compareModels}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Model selection for single mode */}
        {generationMode === "single" && (
          <div className="min-w-[150px] flex-1">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {t.models.usage.model}
            </label>
            <ModelSelect selectedId={selectedModelA} onChange={onModelAChange} />
          </div>
        )}

        {/* Model selection for compare mode */}
        {generationMode === "compare" && (
          <>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {t.models.usage.model} A
              </label>
              <ModelSelect selectedId={selectedModelA} onChange={onModelAChange} />
            </div>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {t.models.usage.model} B
              </label>
              <ModelSelect selectedId={selectedModelB} onChange={onModelBChange} />
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2.5 items-end">
        <div className="flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {cx.additionalRequirements}
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-border rounded-lg text-[13px] bg-muted/50 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            placeholder={estimatedWords
              ? format.template(cx.recommendedWordsPlaceholder, { n: estimatedWords })
              : cx.placeholderExample
            }
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
          {isGenerating ? cx.generating : t.writing.sections.generate}
        </button>
      </div>
    </div>
  );
}
