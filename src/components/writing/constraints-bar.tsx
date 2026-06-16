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
  onGenerationModeChange,
  onWordLimitChange,
  onAdditionalRequirementsChange,
  onModelAChange,
  onModelBChange,
  onGenerate,
  isGenerating,
  onSaveWordLimit,
}: ConstraintsBarProps) {
  const { locale, t } = useLocale();
  const isZh = locale === "zh-CN";
  const noneLabel = t.common.states.none;
  const autoDefault = isZh ? "自动默认" : "Auto Default";
  const singleModel = isZh ? "单模型" : "Single model";
  const compareModels = isZh ? "双模型对比" : "Compare two models";

  return (
    <div className="mb-5 p-4 bg-card border border-border rounded-2xl shadow-sm">
      <div className="flex gap-2.5 flex-wrap items-end mb-3">
        <div className="min-w-[160px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {isZh ? "参考章节" : "Reference Section"}
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
                    {isZh ? "章节" : "Section"} {s.index + 1}. {s.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[120px]">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {isZh ? "字数上限" : "Word Limit"}
          </label>
          <input
            type="number"
            className="w-full px-3 py-2 border border-border rounded-lg text-[13px] bg-muted/50 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            value={wordLimit}
            placeholder={estimatedWords ? (isZh ? `建议 ${estimatedWords}` : `Recommended ${estimatedWords}`) : "500"}
            onChange={(e) => onWordLimitChange(parseInt(e.target.value) || 500)}
            onBlur={() => onSaveWordLimit?.(wordLimit)}
          />
        </div>

        <div className="min-w-[150px] flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {isZh ? "生成模式" : "Generation Mode"}
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
            <Select value={selectedModelA || "auto"} onValueChange={(v) => { if (v) onModelAChange(v); }}>
              <SelectTrigger className="w-full text-[13px] bg-muted/50 focus:bg-card transition-all">
                <SelectValue placeholder={autoDefault}>
                  {selectedModelA && selectedModelA !== "auto"
                    ? models.find((m) => m.id === selectedModelA)?.modelName || selectedModelA
                    : autoDefault}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{autoDefault}</SelectItem>
                {models.map(m => <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Model selection for compare mode */}
        {generationMode === "compare" && (
          <>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {t.models.usage.model} A
              </label>
              <Select value={selectedModelA || "auto"} onValueChange={(v) => { if (v) onModelAChange(v); }}>
                <SelectTrigger className="w-full text-[13px] bg-muted/50 focus:bg-card transition-all">
                  <SelectValue placeholder={autoDefault}>
                    {selectedModelA && selectedModelA !== "auto"
                      ? models.find((m) => m.id === selectedModelA)?.modelName || selectedModelA
                      : autoDefault}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{autoDefault}</SelectItem>
                  {models.map(m => <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[150px] flex-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {t.models.usage.model} B
              </label>
              <Select value={selectedModelB || "auto"} onValueChange={(v) => { if (v) onModelBChange(v); }}>
                <SelectTrigger className="w-full text-[13px] bg-muted/50 focus:bg-card transition-all">
                  <SelectValue placeholder={autoDefault}>
                    {selectedModelB && selectedModelB !== "auto"
                      ? models.find((m) => m.id === selectedModelB)?.modelName || selectedModelB
                      : autoDefault}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{autoDefault}</SelectItem>
                  {models.map(m => <SelectItem key={m.id} value={m.id}>{m.modelName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2.5 items-end">
        <div className="flex-1">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            {isZh ? "额外要求" : "Additional Requirements"}
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-border rounded-lg text-[13px] bg-muted/50 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
            placeholder={estimatedWords
              ? (isZh ? `建议 ${estimatedWords} 字，例如“使用项目符号、包含示例”...` : `Recommended ${estimatedWords} words, e.g., "use bullet points, include examples"...`)
              : (isZh ? "例如：包含时序图..." : "e.g., Include sequence diagrams...")
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
          {isGenerating ? (isZh ? "生成中..." : "Generating...") : t.writing.sections.generate}
        </button>
      </div>
    </div>
  );
}
