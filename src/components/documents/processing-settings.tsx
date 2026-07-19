"use client";

import { useState } from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";
import type { KnowledgeMode } from "@/lib/documents/knowledge-mode";

export type { KnowledgeMode } from "@/lib/documents/knowledge-mode";

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

/**
 * The single user-facing "how deeply should we analyze this document?" choice.
 * Replaces the old Split Strategy / Index Target / Index Mode / Auto-split
 * quartet, which leaked internal pipeline details and forced users to
 * understand chunking, LightRAG, and embedding dimensions.
 *
 * Each value maps 1:1 to backend ProcessingOptions (indexMode + wikiEnabled)
 * with NO backend change — splitStrategy/indexTarget/autoSplit are locked to
 * their best defaults internally.
 *
 *   standard → basic + wiki off   (fastest, minimal tokens)
 *   graph    → graph + wiki off   (retrieval + entity/relation graph)
 *   wiki     → basic + wiki on    (retrieval + synthesized knowledge)
 *   full     → graph + wiki on    (everything — recommended)
 */
/**
 * Map a user-facing KnowledgeMode to the backend ProcessingOptions fields it
 * controls. splitStrategy / indexTarget / autoSplit are locked to their best
 * defaults here so the rest of the pipeline never sees user-tunable internals.
 *
 * Model-agnostic: this is pure option mapping — the backend decides whether
 * graph extraction is actually possible (embedding dim, LLM availability) and
 * gracefully downgrades if not.
 */
export function knowledgeModeToOptions(mode: KnowledgeMode): {
  indexMode: "basic" | "graph";
  wikiEnabled: boolean;
  splitStrategy: "structure-llm";
  indexTarget: "full";
  autoSplit: boolean;
} {
  switch (mode) {
    case "graph":
      return { indexMode: "graph", wikiEnabled: false, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "wiki":
      return { indexMode: "basic", wikiEnabled: true, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "full":
      return { indexMode: "graph", wikiEnabled: true, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
    case "standard":
    default:
      return { indexMode: "basic", wikiEnabled: false, splitStrategy: "structure-llm", indexTarget: "full", autoSplit: true };
  }
}

interface ProcessingSettingsProps {
  llmModels: ModelOption[];
  embedModels: ModelOption[];
  llmModel: string;
  embedModel: string;
  modelsLoaded: boolean;
  knowledgeMode: KnowledgeMode;
  onLlmModelChange: (v: string) => void;
  onEmbedModelChange: (v: string) => void;
  onKnowledgeModeChange: (v: KnowledgeMode) => void;
}

export function ProcessingSettings({
  llmModels, embedModels, llmModel, embedModel, modelsLoaded,
  knowledgeMode,
  onLlmModelChange, onEmbedModelChange, onKnowledgeModeChange,
}: ProcessingSettingsProps) {
  const { t } = useLocale();

  // The selected embedding model drives the graph-capability gate below.
  const selectedEmbed = embedModels.find((m) => m.id === embedModel);

  const hasNoModels = llmModels.length === 0 && embedModels.length === 0;
  const hasNoEmbed = embedModels.length === 0;
  const hasNoLlm = llmModels.length === 0;

  // Graph-capability gate: a graph/full Knowledge Mode needs an embedding
  // model whose dimension is >= 1536 (LightRAG requirement). We DISABLE those
  // two cards (not hide them) when no embedding is selected or the dim is too
  // small / unknown, and surface a single explanatory note — instead of the old
  // scattered basic/graph dropdown + multiple amber warnings.
  const embedDim = selectedEmbed?.embeddingDim ?? 0;
  const embedSelected = !!selectedEmbed && !!embedModel;
  const graphCapable = embedSelected && embedDim >= 1536;
  const graphBlockedReason = !embedSelected
    ? t.documents.processing.kmGraphNeedsEmbed
    : embedDim === 0
      ? t.documents.processing.kmGraphDimUnknown
      : !graphCapable
        ? t.documents.processing.kmGraphDimTooSmall.replace("{dim}", String(embedDim))
        : null;

  // Knowledge Mode cards stay lean (title + one-line gist). The full
  // explanation — a single flowing sentence covering what you get and when to
  // pick it — appears in a panel below ONLY after the user clicks a card, so
  // the default view is uncluttered and the tip feels like a helpful response
  // to their selection.
  const modes: {
    key: KnowledgeMode;
    label: string;
    desc: string;
    detail: string;
    recommended?: boolean;
    disabled?: boolean;
  }[] = [
    {
      key: "standard",
      label: t.documents.processing.kmStandard,
      desc: t.documents.processing.kmStandardDesc,
      detail: t.documents.processing.kmStandardDetail,
    },
    {
      key: "graph",
      label: t.documents.processing.kmGraph,
      desc: t.documents.processing.kmGraphDesc,
      detail: t.documents.processing.kmGraphDetail,
      disabled: !graphCapable,
    },
    {
      key: "wiki",
      label: t.documents.processing.kmWiki,
      desc: t.documents.processing.kmWikiDesc,
      detail: t.documents.processing.kmWikiDetail,
    },
    {
      key: "full",
      label: t.documents.processing.kmFull,
      desc: t.documents.processing.kmFullDesc,
      detail: t.documents.processing.kmFullDetail,
      recommended: true,
      disabled: !graphCapable,
    },
  ];

  // If the currently-selected mode got disabled (e.g. user switched to a
  // low-dim embedding model), gracefully fall back to a still-valid mode so
  // the UI never shows a selected-but-disabled card.
  const effectiveMode = modes.find((m) => m.key === knowledgeMode && !m.disabled)
    ? knowledgeMode
    : (knowledgeMode === "graph" || knowledgeMode === "full" ? "wiki" : knowledgeMode);
  // The full data for the selected mode — drives the detail panel.
  const selectedModeData = modes.find((m) => m.key === effectiveMode) ?? null;
  // The detail panel is visible by default so the pre-selected mode (Full
  // analysis) shows its explanation on first load — matching the expectation
  // that a selected card has an active tip. Clicking any (other) card keeps it
  // visible and updates the tip to that card.
  const [detailVisible, setDetailVisible] = useState(true);

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

          {/* Knowledge Mode — the single user-facing "how deep?" choice.
              Replaces Split Strategy + Index Target + Index Mode + Auto-split.
              Cards stay lean (title + one-line gist); selecting one reveals a
              contextual detail panel below with "what you get / best for",
              matching the app's select-then-show-detail pattern. */}
          <div className="col-span-2">
            <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">
              {t.documents.processing.knowledgeMode}
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {modes.map((m) => {
                const selected = effectiveMode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => {
                      if (m.disabled) return;
                      onKnowledgeModeChange(m.key);
                      setDetailVisible(true);
                    }}
                    className={`text-left px-3.5 py-2.5 rounded-xl border transition-all relative ${
                      selected
                        ? "border-primary bg-primary/8 ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-primary/40 hover:bg-primary/4"
                    } ${m.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {m.recommended && (
                      <span className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                        {t.documents.processing.kmRecommended}
                      </span>
                    )}
                    <div className={`text-[13px] font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                      {m.label}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>

            {/* Detail tip for the SELECTED mode — appears ONLY after the user
                clicks a card, as a single flowing sentence. Feels like a helpful
                response to the selection rather than static clutter. */}
            {detailVisible && selectedModeData && (
              <div className="mt-3 px-4 py-3 bg-muted/50 rounded-xl border border-border animate-fade-in-up flex gap-2.5">
                <svg className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                <p className="text-[12px] text-foreground/80 leading-relaxed">{selectedModeData.detail}</p>
              </div>
            )}

            {graphBlockedReason && (
              <p className="text-[12px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 mt-2">
                {graphBlockedReason}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
