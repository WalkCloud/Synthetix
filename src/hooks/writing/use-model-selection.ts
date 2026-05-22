"use client";

import { useState, useEffect } from "react";
import { parseCapabilities } from "@/lib/llm/capabilities";
import type { ModelOption } from "@/types/writing";

export function useModelSelection() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelA, setSelectedModelA] = useState<string>("");
  const [selectedModelB, setSelectedModelB] = useState<string>("");

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const allModels = data.data.flatMap((p: { models?: ModelOption[] }) => p.models || []);
          const chatModels = allModels.filter((m: ModelOption) => {
            return parseCapabilities(m.capabilities).includes("chat");
          });
          setModels(chatModels);
        }
      })
      .catch((err) => console.error("Failed to load models:", err));
  }, []);

  return { models, selectedModelA, selectedModelB, setSelectedModelA, setSelectedModelB };
}
