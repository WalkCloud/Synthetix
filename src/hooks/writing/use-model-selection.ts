"use client";

import { useState, useEffect } from "react";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { findDefaultChatModel, findFirstNonDefault } from "@/lib/writing/model-default";
import type { ModelOption } from "@/types/writing";

export function useModelSelection() {
  const [models, setModels] = useState<ModelOption[]>([]);
  // Empty string means "user has not picked yet" — we auto-fill these from the
  // user's default model settings once models load, so the selectors never show
  // a vague "auto" label and the user always sees which model will run.
  const [selectedModelA, setSelectedModelA] = useState<string>("");
  const [selectedModelB, setSelectedModelB] = useState<string>("");

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          type RawModel = { id: string; modelName: string; capabilities: string; isDefaultFor?: string | null };
          const allModels: RawModel[] = data.data.flatMap((p: { models?: RawModel[] }) => p.models || []);
          const chatModels: ModelOption[] = allModels
            .filter((m) => parseCapabilities(m.capabilities).includes("chat"))
            .map((m) => ({ id: m.id, modelName: m.modelName, capabilities: m.capabilities, isDefaultFor: m.isDefaultFor ?? null }));
          setModels(chatModels);

          // Auto-select sane defaults so the UI shows real model names:
          //  - Model A → the user's default chat model
          //  - Model B → first non-default model (for compare mode)
          const def = findDefaultChatModel(chatModels);
          setSelectedModelA((prev) => prev || def?.id || chatModels[0]?.id || "");
          const b = findFirstNonDefault(chatModels, def?.id);
          setSelectedModelB((prev) => prev || b?.id || "");
        }
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  const defaultModelId = findDefaultChatModel(models)?.id ?? null;

  return { models, selectedModelA, selectedModelB, defaultModelId, setSelectedModelA, setSelectedModelB };
}
