"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { UploadZone } from "@/components/documents/upload-zone";
import { UploadQueue } from "@/components/documents/upload-queue-panel";
import type { UploadItem } from "@/components/documents/upload-queue-panel";
import { ProcessingSettings, type ModelOption } from "@/components/documents/processing-settings";
import { SUPPORTED_FORMATS } from "@/types/documents";
import { useLocale } from "@/lib/i18n";

export default function DocumentsPage() {
  const { t } = useLocale();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [llmModels, setLlmModels] = useState<ModelOption[]>([]);
  const [embedModels, setEmbedModels] = useState<ModelOption[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [splitStrategy, setSplitStrategy] = useState("structure-llm");
  const [indexTarget, setIndexTarget] = useState("full");
  // Default to "basic" (safe) rather than "graph": graph mode requires an
  // embedding dim >= LIGHTRAG_MIN_DIM, and that dim is only known after it
  // has been probed. A dedicated effect below upgrades to "graph" once the
  // selected embedding model is confirmed compatible — covering BOTH the
  // auto-selected default model (useEffect in fetchProviders) and manual
  // changes. Previously the initial "graph" + a downgrade check that only
  // fired on manual selection meant new users silently shipped "graph" with
  // an unknown/null dim, and the backend then downgraded it with no feedback.
  const [indexMode, setIndexMode] = useState<"basic" | "graph">("basic");
  const [autoSplit, setAutoSplit] = useState(true);
  const [processing, setProcessing] = useState(false);
  // False until the first /models/providers fetch settles. Gates the
  // "no models configured" warning so we don't flash it on every refresh
  // while the model list is still loading (empty arrays look identical to
  // "genuinely unconfigured" before the fetch returns).
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // Minimum embedding dimension LightRAG needs for knowledge-graph entity
  // extraction. Mirrors isLightRAGCompatible() in src/lib/rag/dimension.ts.
  const LIGHTRAG_MIN_DIM = 1536;

  // Keep indexMode in sync with the selected embedding model's dimension.
  // This fires for BOTH auto-selection (the fetch effect below calls
  // setEmbedModel directly) and manual selection (handleEmbedModelChange),
  // so the graph/basic choice always reflects the actually-selected model.
  // Unknown dim (null/0) or < LIGHTRAG_MIN_DIM → basic; >= → graph.
  useEffect(() => {
    if (!embedModel) return;
    const m = embedModels.find((x) => x.id === embedModel);
    const dim = m?.embeddingDim ?? 0;
    setIndexMode(dim >= LIGHTRAG_MIN_DIM ? "graph" : "basic");
  }, [embedModel, embedModels]);

  const handleEmbedModelChange = useCallback((id: string) => {
    setEmbedModel(id);
  }, []);

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return;
        const llm: ModelOption[] = [];
        const embed: ModelOption[] = [];
        for (const p of data.data) {
          for (const m of p.models) {
            const caps = parseCapabilities(m.capabilities);
            const entry: ModelOption = {
              id: m.id,
              modelName: m.modelName,
              providerName: p.name,
              embeddingDim: m.embeddingDim,
              contextWindow: m.contextWindow,
              isDefaultFor: m.isDefaultFor,
            };
            if (caps.some((c) => c === "embedding" || c === "embed")) {
              embed.push(entry);
            } else if (caps.includes("chat")) {
              llm.push(entry);
            }
          }
        }
        setLlmModels(llm);
        setEmbedModels(embed);
        const defaultEmbed = embed.find((m) => m.isDefaultFor === "embedding");
        if (defaultEmbed) setEmbedModel(defaultEmbed.id);
        else if (embed.length > 0) setEmbedModel(embed[0].id);
        const defaultLlm = llm.find((m) => m.isDefaultFor === "llm");
        if (defaultLlm) setLlmModel(defaultLlm.id);
        else if (llm.length > 0) setLlmModel(llm[0].id);
      })
      .catch(() => {})
      .finally(() => setModelsLoaded(true));
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const supportedExts = new Set(SUPPORTED_FORMATS);
    const arr = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return supportedExts.has(ext as typeof SUPPORTED_FORMATS[number]);
    });
    if (arr.length === 0) return;

    // Warn if no embedding model configured
    const effectiveIndexTarget = embedModels.length === 0 ? "original" : indexTarget;
    if (embedModels.length === 0) {
      toast.warning(t.errors.noEmbeddingUpload);
    }

    for (const file of arr) {
      const id = crypto.randomUUID();
      const item: UploadItem = { id, name: file.name, size: file.size, status: "converting", progress: 50 };
      setUploads((prev) => [...prev, item]);

      const fd = new FormData();
      fd.append("file", file);
      if (llmModel) fd.append("llmModelId", llmModel);
      if (embedModel) fd.append("embedModelId", embedModel);
      fd.append("splitStrategy", splitStrategy);
      fd.append("indexTarget", effectiveIndexTarget);
      fd.append("indexMode", indexMode);
      fd.append("autoSplit", String(autoSplit));
      try {
        const res = await fetch("/api/v1/documents/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "complete", progress: 100, docId: data.data.document.id } : u));
        } else if (data.error === "DUPLICATE") {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "complete", progress: 100, docId: data.existingId } : u));
        } else {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: data.error } : u));
        }
      } catch {
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: t.documents.upload.uploadFailed } : u));
      }
    }
  }, [llmModel, embedModel, splitStrategy, indexTarget, indexMode, autoSplit, embedModels.length, t]);

  function removeUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleProcess() {
    const ready = uploads.filter((u) => u.status === "complete" && u.docId);
    if (ready.length === 0) {
      toast.error(t.documents.upload.noFileProvided);
      return;
    }
    setProcessing(true);
    let success = 0;
    let fail = 0;
    for (const u of ready) {
      try {
        const res = await fetch(`/api/v1/documents/${u.docId}/reprocess`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              options: {
                llmModelId: llmModel || undefined,
                embedModelId: embedModel || undefined,
                splitStrategy,
                indexTarget: embedModels.length === 0 ? "original" : indexTarget,
                indexMode,
                autoSplit,
              },
          }),
        });
        const data = await res.json();
        if (data.success) {
          success++;
        } else {
          fail++;
        }
      } catch {
        fail++;
      }
    }
    setProcessing(false);
    if (fail === 0) {
      toast.success(`${success} ${t.documents.upload.queued}`);
    } else {
      toast.warning(`${success} ${t.documents.upload.queued}, ${fail} ${t.common.states.failed}`);
    }
  }

  return (
    <div>
      <Header title={t.documents.title} />
      <div className="p-8">
        <UploadZone onFiles={handleFiles} />
        <UploadQueue items={uploads} onRemove={removeUpload} />
        <ProcessingSettings
          llmModels={llmModels} embedModels={embedModels}
          llmModel={llmModel} embedModel={embedModel}
          modelsLoaded={modelsLoaded}
          splitStrategy={splitStrategy}
          indexTarget={indexTarget} indexMode={indexMode} autoSplit={autoSplit}
          onLlmModelChange={setLlmModel} onEmbedModelChange={handleEmbedModelChange}
          onSplitStrategyChange={setSplitStrategy}
          onIndexTargetChange={setIndexTarget} onIndexModeChange={setIndexMode}
          onAutoSplitChange={setAutoSplit}
        />
        {uploads.length > 0 && (
          <div className="flex justify-end animate-fade-in-up">
            <button
              onClick={handleProcess}
              disabled={processing || !uploads.some((u) => u.status === "complete")}
              className="inline-flex items-center gap-2 px-7 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light hover:shadow-lg hover:-translate-y-px transition-all text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Spinner size="sm" className="text-white" />
                  {t.common.states.processing}...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  {t.documents.processing.startProcessing}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
