"use client";

import { useCallback } from "react";
import { parseCapabilities } from "@/lib/llm/capabilities";

interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  capabilities: string[];
  contextWindow: number | null;
}

export function useModelsByCapability() {
  const fetchModels = useCallback(async (capability: "chat" | "embedding" | "image_generation"): Promise<ModelOption[]> => {
    const res = await fetch("/api/v1/models/providers");
    const data = await res.json();
    if (!data.success) return [];

    const results: ModelOption[] = [];
    for (const provider of data.data) {
      for (const model of provider.models || []) {
        const caps = parseCapabilities(model.capabilities);
        const matches = capability === "embedding"
          ? caps.some((c) => c === "embedding" || c === "embed")
          : caps.includes(capability);
        if (matches) {
          results.push({
            providerId: provider.id,
            providerName: provider.name,
            modelId: model.modelId,
            modelName: model.modelName || model.modelId,
            capabilities: caps,
            contextWindow: model.contextWindow,
          });
        }
      }
    }
    return results;
  }, []);

  return { fetchModels };
}
