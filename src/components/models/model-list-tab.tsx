"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { Provider } from "./types";
import { ModelCard } from "./model-card";

interface IconColors {
  bg: string;
  text: string;
}

const MODEL_ICON_COLORS: IconColors[] = [
  { bg: "bg-blue-50 dark:bg-blue-950/35", text: "text-blue-600 dark:text-blue-400" },
  { bg: "bg-green-50 dark:bg-green-950/35", text: "text-green-600 dark:text-green-400" },
  { bg: "bg-yellow-50 dark:bg-yellow-950/35", text: "text-yellow-600 dark:text-yellow-400" },
  { bg: "bg-orange-50 dark:bg-orange-950/35", text: "text-orange-600 dark:text-orange-400" },
  { bg: "bg-primary-50 dark:bg-primary-950/35", text: "text-primary-600 dark:text-primary-400" },
];

type ModelSlot = "llm" | "embedding" | "rerank" | "image";

interface ModelListTabProps {
  providers: Provider[];
  slot: ModelSlot;
  loading?: boolean;
  testingId: string | null;
  testResult: { id: string; connected: boolean; contextWindows?: Record<string, number>; error?: string; embedDimErrors?: string[] } | null;
  deletingId: string | null;
  onTest: (id: string) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  onToggleDefault: (modelConfigId: string, slot: ModelSlot, isCurrentlyDefault: boolean) => void;
  onAdd: () => void;
}

function isDefaultForSlot(
  model: Provider["models"][number],
  slot: ModelSlot,
): boolean {
  if (model.isDefaultFor === slot) return true;
  if (model.isDefaultFor !== "default") return false;
  const caps = parseCapabilities(model.capabilities);
  if (slot === "embedding") return caps.some((c) => c === "embedding" || c === "embed");
  if (slot === "rerank") return caps.includes("rerank");
  if (slot === "image") return caps.includes("image_generation");
  return !caps.some((c) => c === "embedding" || c === "embed" || c === "rerank" || c === "image_generation");
}

function filterModels(providers: Provider[], slot: ModelSlot) {
  const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
  providers.forEach((p) => {
    p.models.forEach((m, idx) => {
      const caps = parseCapabilities(m.capabilities);
      const isEmbed = caps.some((c) => c === "embedding" || c === "embed");
      const isRerank = caps.includes("rerank");
      const isImage = caps.includes("image_generation");
      if (slot === "embedding" && !isEmbed) return;
      if (slot === "rerank" && !isRerank) return;
      if (slot === "image" && !isImage) return;
      if (slot === "llm" && (isEmbed || isRerank || isImage)) return;
      const colorIdx = result.length % MODEL_ICON_COLORS.length;
      result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
    });
  });
  return result;
}

export function ModelListTab({
  providers, slot, loading, testingId, testResult, deletingId,
  onTest, onEdit, onDelete, onDeleteConfirm, onDeleteCancel,
  onToggleDefault, onAdd,
}: ModelListTabProps) {
  const { t } = useLocale();
  const models = useMemo(() => filterModels(providers, slot), [providers, slot]);
  const info = {
    llm: {
      description: t.models.list.llmDesc,
      addTitle: t.models.list.addLlmTitle,
      addSubtitle: t.models.list.addLlmSubtitle,
      empty: t.models.list.emptyLlm,
    },
    embedding: {
      description: t.models.list.embeddingDesc,
      addTitle: t.models.list.addEmbeddingTitle,
      addSubtitle: t.models.list.addEmbeddingSubtitle,
      empty: t.models.list.emptyEmbedding,
    },
    rerank: {
      description: t.models.list.rerankDesc,
      addTitle: t.models.list.addRerankTitle,
      addSubtitle: t.models.list.addRerankSubtitle,
      empty: t.models.list.emptyRerank,
    },
    image: {
      description: t.models.list.imageDesc,
      addTitle: t.models.list.addImageTitle,
      addSubtitle: t.models.list.addImageSubtitle,
      empty: t.models.list.emptyImage,
    },
  }[slot];

  return (
    <div className="animate-fade-in-up">
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{info.description}</p>
      {loading && slot === "llm" ? (
        <div className="text-center py-12 text-muted-foreground">{t.common.actions.loading}</div>
      ) : (
        <div className="space-y-4">
          {models.map(({ provider, modelIndex, iconColors }) => {
            const model = provider.models[modelIndex];
            return (
              <ModelCard
                key={`${provider.id}-${model.id}`}
                name={model.modelName}
                providerName={provider.name}
                contextWindow={model.contextWindow}
                isActive={provider.isActive}
                isTesting={testingId === provider.id}
                testResult={testResult?.id === provider.id ? testResult : null}
                isDeleting={deletingId === provider.id}
                iconColors={iconColors}
                isDefault={isDefaultForSlot(model, slot)}
                onTest={() => onTest(provider.id)}
                onEdit={() => onEdit(provider)}
                onDelete={() => onDelete(provider.id)}
                onDeleteConfirm={() => onDeleteConfirm(provider.id)}
                onDeleteCancel={onDeleteCancel}
                onToggleDefault={() => onToggleDefault(model.id, slot, isDefaultForSlot(model, slot))}
              />
            );
          })}
          {models.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-border rounded-2xl bg-muted/50">
              {info.empty}
            </div>
          )}
          <button
            onClick={onAdd}
            className="w-full bg-muted/50 border border-dashed border-border rounded-2xl px-6 py-5 flex items-center gap-4 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 transition-all cursor-pointer group shadow-soft"
            style={{ animation: "fadeInUp 0.4s ease both 0.2s" }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-card shadow-sm text-muted-foreground group-hover:text-primary-600 transition-colors">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-base font-semibold text-foreground/75 group-hover:text-primary-700 transition-colors">{info.addTitle}</div>
              <div className="text-sm text-muted-foreground">{info.addSubtitle}</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
