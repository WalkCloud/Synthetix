"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { UploadZone } from "@/components/documents/upload-zone";
import { UploadQueue } from "@/components/documents/upload-queue-panel";
import type { UploadItem } from "@/components/documents/upload-queue-panel";
import { ProcessingSettings, modelLabel, type ModelOption } from "@/components/documents/processing-settings";
import { SUPPORTED_FORMATS } from "@/types/documents";
import { useLocale } from "@/lib/i18n";

export default function DocumentsPage() {
  const { t } = useLocale();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [llmModels, setLlmModels] = useState<ModelOption[]>([]);
  const [embedModels, setEmbedModels] = useState<ModelOption[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [contextUsage, setContextUsage] = useState(45);
  const [splitStrategy, setSplitStrategy] = useState("structure-llm");
  const [indexTarget, setIndexTarget] = useState("full");
  const [indexMode, setIndexMode] = useState<"basic" | "graph">("basic");
  const [autoSplit, setAutoSplit] = useState(true);
  const [processing, setProcessing] = useState(false);

  const handleEmbedModelChange = useCallback((id: string) => {
    setEmbedModel(id);
    const m = embedModels.find((x) => x.id === id);
    if (m && (m.embeddingDim ?? 0) < 1536) {
      setIndexMode("basic");
    }
  }, [embedModels]);

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
            const entry: ModelOption = { id: m.id, modelName: m.modelName, providerName: p.name, embeddingDim: m.embeddingDim, isDefaultFor: m.isDefaultFor };
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
      .catch(() => {});
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const supportedExts = new Set(SUPPORTED_FORMATS);
    const arr = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      return supportedExts.has(ext as typeof SUPPORTED_FORMATS[number]);
    });
    if (arr.length === 0) return;
    for (const file of arr) {
      const id = crypto.randomUUID();
      const item: UploadItem = { id, name: file.name, size: file.size, status: "converting", progress: 50 };
      setUploads((prev) => [...prev, item]);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("llmModelId", llmModel);
      fd.append("embedModelId", embedModel);
      fd.append("contextUsage", String(contextUsage));
      fd.append("splitStrategy", splitStrategy);
      fd.append("indexTarget", indexTarget);
      fd.append("indexMode", indexMode);
      fd.append("autoSplit", String(autoSplit));
      try {
        const res = await fetch("/api/v1/documents/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "complete", progress: 100, docId: data.data.document.id } : u));
        } else if (data.error === "DUPLICATE") {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "complete", progress: 100, docId: data.data.existingId } : u));
        } else {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: data.error } : u));
        }
      } catch {
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: t.documents.upload.uploadFailed } : u));
      }
    }
  }, [llmModel, embedModel, contextUsage, splitStrategy, indexTarget, indexMode, autoSplit, t.documents.upload.uploadFailed]);

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
                contextUsage,
                splitStrategy,
                indexTarget,
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
          contextUsage={contextUsage} splitStrategy={splitStrategy}
          indexTarget={indexTarget} indexMode={indexMode} autoSplit={autoSplit}
          onLlmModelChange={setLlmModel} onEmbedModelChange={handleEmbedModelChange}
          onContextUsageChange={setContextUsage} onSplitStrategyChange={setSplitStrategy}
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
