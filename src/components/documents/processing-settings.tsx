"use client";

import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";

interface ModelOption {
  id: string;
  modelName: string;
  providerName: string;
  embeddingDim?: number | null;
  contextWindow?: number;
  isDefaultFor?: string | null;
}

export function modelLabel(models: ModelOption[], id: string): string {
  const m = models.find((x) => x.id === id);
  return m ? `${m.modelName} (${m.providerName})` : "";
}

export type { ModelOption };

interface ProcessingSettingsProps {
  llmModels: ModelOption[];
  embedModels: ModelOption[];
  llmModel: string;
  embedModel: string;
  modelsLoaded: boolean;
  splitStrategy: string;
  indexTarget: string;
  indexMode: "basic" | "graph";
  autoSplit: boolean;
  onLlmModelChange: (v: string) => void;
  onEmbedModelChange: (v: string) => void;
  onSplitStrategyChange: (v: string) => void;
  onIndexTargetChange: (v: string) => void;
  onIndexModeChange: (v: "basic" | "graph") => void;
  onAutoSplitChange: (v: boolean) => void;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function ProcessingSettings({
  llmModels, embedModels, llmModel, embedModel, modelsLoaded,
  splitStrategy, indexTarget, indexMode, autoSplit,
  onLlmModelChange, onEmbedModelChange,
  onSplitStrategyChange, onIndexTargetChange, onIndexModeChange, onAutoSplitChange,
}: ProcessingSettingsProps) {
  const { t } = useLocale();

  // Compute auto chunk size — based on embedding model's max input tokens
  const DEFAULT_LLM_CONTEXT = 200000;
  const DEFAULT_EMBED_MAX_TOKENS = 8192;
  const selectedEmbed = embedModels.find((m) => m.id === embedModel);
  const embedMaxTokens = (selectedEmbed?.contextWindow ?? 0) > 0
    ? selectedEmbed!.contextWindow!
    : DEFAULT_EMBED_MAX_TOKENS;
  const isUsingDefaultEmbed = !selectedEmbed || (selectedEmbed.contextWindow ?? 0) === 0;
  const chunkMaxTokens = Math.floor(embedMaxTokens * 0.9);

  const hasNoModels = llmModels.length === 0 && embedModels.length === 0;
  const hasNoEmbed = embedModels.length === 0;
  const hasNoLlm = llmModels.length === 0;

  const splitLabels: Record<string, string> = {
    "structure-llm": t.documents.processing.splitOptions.structureLlm,
    "heading-only": t.documents.processing.splitOptions.headingOnly,
  };

  const indexLabels: Record<string, string> = {
    full: t.documents.processing.indexOptions.full,
    original: t.documents.processing.indexOptions.original,
    chunks: t.documents.processing.indexOptions.chunks,
  };

  const graphLabels: Record<string, string> = {
    basic: t.documents.processing.graphOptions.basic,
    graph: t.documents.processing.graphOptions.graph,
  };

  return (
    <div className="bg-card border border-border rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border">
        <h3 className="font-display text-[16px] font-semibold text-foreground">{t.documents.processing.processingSettings}</h3>
      </div>
      <div className="p-6">
        {/* Warning banners — hidden until models have finished loading so the
            empty-while-fetching state isn't mistaken for "unconfigured". */}
        {hasNoModels && modelsLoaded && (
          <div className="mb-6 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-red-800 text-[13px]">
            <span className="font-semibold">⚠</span>{" "}
            {t.documents.processing.noModelsWarning}{" "}
            <Link href="/models" className="underline font-medium hover:text-red-900">{t.documents.processing.modelManagementLink}</Link>
          </div>
        )}
        {!hasNoModels && hasNoEmbed && modelsLoaded && (
          <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-[13px]">
            <span className="font-semibold">⚠</span>{" "}
            {t.documents.processing.noEmbeddingWarning}{" "}
            <Link href="/models" className="underline font-medium hover:text-amber-900">{t.documents.processing.modelManagementLink}</Link>
          </div>
        )}
        {!hasNoModels && !hasNoEmbed && hasNoLlm && modelsLoaded && (
          <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-[13px]">
            <span className="font-semibold">⚠</span>{" "}
            {t.documents.processing.noLlmWarning}{" "}
            <Link href="/models" className="underline font-medium hover:text-amber-900">{t.documents.processing.modelManagementLink}</Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.llmModel}</label>
            <Select value={llmModel} onValueChange={(v) => onLlmModelChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{modelLabel(llmModels, llmModel) || t.documents.processing.selectModel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {!modelsLoaded ? (
                  <SelectItem value="none" disabled>{t.common.states.loading}…</SelectItem>
                ) : llmModels.length === 0 ? (
                  <SelectItem value="none" disabled>{t.errors.modelNotConfigured}</SelectItem>
                ) : (
                  llmModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.embeddingModel}</label>
            <Select value={embedModel} onValueChange={(v) => onEmbedModelChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{modelLabel(embedModels, embedModel) || t.documents.processing.selectModel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {!modelsLoaded ? (
                  <SelectItem value="none" disabled>{t.common.states.loading}…</SelectItem>
                ) : embedModels.length === 0 ? (
                  <SelectItem value="none" disabled>{t.errors.modelNotConfigured}</SelectItem>
                ) : (
                  embedModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Auto chunk size display (replaces slider) */}
          <div className="col-span-2">
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.autoChunkSize}</label>
            {!isUsingDefaultEmbed ? (
              <div className="px-3.5 py-2.5 bg-muted/50 rounded-lg border border-border">
                <span className="text-[14px] font-semibold text-primary">{formatTokens(chunkMaxTokens)}</span>
                <span className="text-[12px] text-muted-foreground ml-1">tokens</span>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {t.documents.processing.autoChunkSizeDesc
                    .replace("{tokens}", formatTokens(chunkMaxTokens))
                    .replace("{context}", formatTokens(embedMaxTokens))
                    .replace("{model}", selectedEmbed?.modelName || "")}
                </p>
              </div>
            ) : (
              <div className="px-3.5 py-2.5 bg-muted/50 rounded-lg border border-border">
                <span className="text-[14px] font-semibold text-primary">{formatTokens(chunkMaxTokens)}</span>
                <span className="text-[12px] text-muted-foreground ml-1">tokens</span>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {t.documents.processing.defaultChunkSize
                    .replace("{tokens}", formatTokens(chunkMaxTokens))
                    .replace("{context}", formatTokens(DEFAULT_EMBED_MAX_TOKENS))}
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.splitStrategy}</label>
            <Select value={splitStrategy} onValueChange={(v) => onSplitStrategyChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{splitLabels[splitStrategy] ?? splitStrategy}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="structure-llm">{splitLabels["structure-llm"]}</SelectItem>
                <SelectItem value="heading-only">{splitLabels["heading-only"]}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground mt-2">{t.documents.processing.splitStrategyDesc}</p>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.indexTarget}</label>
            <Select value={indexTarget} onValueChange={(v) => onIndexTargetChange(v!)}>
              <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                <SelectValue>{indexLabels[indexTarget] ?? indexTarget}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{indexLabels.full}</SelectItem>
                <SelectItem value="original">{indexLabels.original}</SelectItem>
                <SelectItem value="chunks">{indexLabels.chunks}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground mt-2">{t.documents.processing.indexTargetDesc}</p>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.documents.processing.indexMode}</label>
            {(() => {
              const dim = selectedEmbed?.embeddingDim ?? 0;
              const probed = dim > 0;
              const lightragCompatible = dim >= 1536;
                if (!selectedEmbed || !embedModel) {
                return (
                  <>
                    <Select value="basic" onValueChange={() => {}}>
                      <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm opacity-60">
                        <SelectValue>{graphLabels.basic}</SelectValue>
                      </SelectTrigger>
                    </Select>
                    <p className="text-[12px] text-muted-foreground mt-2">{t.documents.processing.graphNoEmbedding}</p>
                  </>
                );
              }
              return (
                <>
                  <Select value={indexMode} onValueChange={(v) => onIndexModeChange(v as "basic" | "graph")}>
                    <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                      <SelectValue>{graphLabels[indexMode]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="graph" disabled={!probed || !lightragCompatible}>
                        {graphLabels.graph}
                      </SelectItem>
                      <SelectItem value="basic">{graphLabels.basic}</SelectItem>
                    </SelectContent>
                  </Select>
                  {!probed && (
                    <p className="text-[12px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                      {t.documents.processing.graphDimUnknown}
                    </p>
                  )}
                  {probed && !lightragCompatible && (
                    <p className="text-[12px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                      {t.documents.processing.graphDimTooSmall.replace("{dim}", String(dim))}
                    </p>
                  )}
                  {probed && lightragCompatible && (
                    <p className="text-[12px] text-muted-foreground mt-2">{t.documents.processing.graphDesc}</p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-0.5">{t.documents.processing.autoSplit}</label>
                <p className="text-[12px] text-muted-foreground">{t.documents.processing.autoSplitDesc}</p>
              </div>
              <label className="relative w-11 h-6 cursor-pointer">
                <input type="checkbox" checked={autoSplit} onChange={(e) => onAutoSplitChange(e.target.checked)} className="sr-only peer"/>
                <span className="absolute inset-0 bg-muted rounded-full transition-all duration-200 peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-[18px] after:h-[18px] after:bg-card after:rounded-full after:transition-transform after:duration-200 peer-checked:after:translate-x-5"/>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
