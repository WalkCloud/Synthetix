"use client";

import { useMemo } from "react";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { Provider } from "./types";
import { ModelCard } from "./model-card";

interface IconColors {
  bg: string;
  text: string;
}

const MODEL_ICON_COLORS: IconColors[] = [
  { bg: "bg-blue-50", text: "text-blue-600" },
  { bg: "bg-green-50", text: "text-green-600" },
  { bg: "bg-yellow-50", text: "text-yellow-600" },
  { bg: "bg-orange-50", text: "text-orange-600" },
  { bg: "bg-primary-50", text: "text-primary-600" },
];

type ModelSlot = "llm" | "embedding" | "image";

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
  if (slot === "image") return caps.includes("image_generation");
  return !caps.some((c) => c === "embedding" || c === "embed" || c === "image_generation");
}

function filterModels(providers: Provider[], slot: ModelSlot) {
  const result: Array<{ provider: Provider; modelIndex: number; iconColors: IconColors }> = [];
  providers.forEach((p) => {
    p.models.forEach((m, idx) => {
      const caps = parseCapabilities(m.capabilities);
      const isEmbed = caps.some((c) => c === "embedding" || c === "embed");
      const isImage = caps.includes("image_generation");
      if (slot === "embedding" && !isEmbed) return;
      if (slot === "image" && !isImage) return;
      if (slot === "llm" && (isEmbed || isImage)) return;
      const colorIdx = result.length % MODEL_ICON_COLORS.length;
      result.push({ provider: p, modelIndex: idx, iconColors: MODEL_ICON_COLORS[colorIdx] });
    });
  });
  return result;
}

const SLOT_INFO: Record<ModelSlot, { label: string; description: string; addTitle: string; addSubtitle: string; empty: string }> = {
  llm: {
    label: "LLM Models",
    description: "Configure LLM models for writing, chat, brainstorming, and other generation tasks.",
    addTitle: "Add LLM Model",
    addSubtitle: "Ollama, OpenAI, Anthropic, or custom endpoint",
    empty: "No LLM models configured. Click \"Add LLM Model\" to connect a provider.",
  },
  embedding: {
    label: "Embedding Models",
    description: "Configure embedding models for document indexing and semantic search retrieval. Switching embedding models requires re-indexing all documents.",
    addTitle: "Add Embedding Model",
    addSubtitle: "Connect an embedding service for document indexing",
    empty: "No embedding models configured. Add a provider with embedding capability.",
  },
  image: {
    label: "Image Generation",
    description: "Configure text-to-image models for the Gen feature in the writing panel. These models generate illustrations from text prompts via OpenAI-compatible image APIs.",
    addTitle: "Add Image Model",
    addSubtitle: "DALL-E, Flux, Wanx, or other OpenAI-compatible image endpoint",
    empty: "No image generation models configured. Add a provider with an image generation model (e.g. DALL-E, Flux, Wanx).",
  },
};

export function ModelListTab({
  providers, slot, loading, testingId, testResult, deletingId,
  onTest, onEdit, onDelete, onDeleteConfirm, onDeleteCancel,
  onToggleDefault, onAdd,
}: ModelListTabProps) {
  const models = useMemo(() => filterModels(providers, slot), [providers, slot]);
  const info = SLOT_INFO[slot];

  return (
    <div className="animate-fade-in-up">
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{info.description}</p>
      {loading && slot === "llm" ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
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
            <div className="p-8 text-center text-muted-foreground text-sm border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
              {info.empty}
            </div>
          )}
          <button
            onClick={onAdd}
            className="w-full bg-slate-50 border border-dashed border-slate-300 rounded-2xl px-6 py-5 flex items-center gap-4 hover:border-primary-400 hover:bg-primary-50 transition-all cursor-pointer group shadow-soft"
            style={{ animation: "fadeInUp 0.4s ease both 0.2s" }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-white shadow-sm text-slate-400 group-hover:text-primary-600 transition-colors">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-base font-semibold text-slate-700 group-hover:text-primary-700 transition-colors">{info.addTitle}</div>
              <div className="text-sm text-slate-500">{info.addSubtitle}</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
