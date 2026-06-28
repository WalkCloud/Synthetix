"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { parseCapabilities } from "@/lib/llm/capabilities";
import { toast } from "sonner";
import { Spinner } from "@/components/shared/spinner";
import { UploadZone } from "@/components/documents/upload-zone";
import { UploadQueue } from "@/components/documents/upload-queue-panel";
import type { UploadItem } from "@/components/documents/upload-queue-panel";
import { ProcessingNotice } from "@/components/documents/processing-notice";
import { ProcessingSettings, type ModelOption, type KnowledgeMode, knowledgeModeToOptions } from "@/components/documents/processing-settings";
import { SUPPORTED_FORMATS } from "@/types/documents";
import { useLocale } from "@/lib/i18n";

export default function DocumentsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [llmModels, setLlmModels] = useState<ModelOption[]>([]);
  const [embedModels, setEmbedModels] = useState<ModelOption[]>([]);
  const [llmModel, setLlmModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  // The single user-facing "how deeply should we analyze this document?" choice.
  // Replaces the old splitStrategy / indexTarget / indexMode / autoSplit quartet.
  // `full` is the recommended default; the ProcessingSettings component disables
  // graph-requiring cards and falls back when the selected embedding model can't
  // support graph extraction (dim < 1536).
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("full");
  const [processing, setProcessing] = useState(false);
  // Live snapshot of the uploaded-but-not-yet-processed files. Drives a
  // pre-Start-Processing time estimate so users know large batches will take a
  // while before they commit to running them. Derived from the completed
  // uploads whenever the queue changes; cleared once processing is kicked off.
  const [uploadedBatch, setUploadedBatch] = useState<{
    totalBytes: number;
    fileCount: number;
  } | null>(null);
  // False until the first /models/providers fetch settles. Gates the
  // "no models configured" warning so we don't flash it on every refresh
  // while the model list is still loading (empty arrays look identical to
  // "genuinely unconfigured" before the fetch returns).
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const handleEmbedModelChange = useCallback((id: string) => {
    setEmbedModel(id);
  }, []);

  // Keep the pre-Start-Processing batch snapshot in sync with completed
  // uploads. This drives the "this will take a while" hint shown before the
  // user kicks off processing. We recompute from the queue so it stays correct
  // as files finish uploading or are removed.
  useEffect(() => {
    const ready = uploads.filter((u) => u.status === "complete" && u.docId);
    if (processing || ready.length === 0) {
      setUploadedBatch(null);
      return;
    }
    setUploadedBatch({
      totalBytes: ready.reduce((sum, u) => sum + u.size, 0),
      fileCount: ready.length,
    });
  }, [uploads, processing]);

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
    if (embedModels.length === 0) {
      toast.warning(t.errors.noEmbeddingUpload);
    }

    // Resolve the user's Knowledge Mode into the backend processing options.
    // When no embedding model is configured, force indexTarget to "original"
    // (skip embedding) — the upload still persists, processing just won't index.
    const opts = knowledgeModeToOptions(knowledgeMode);
    const effectiveIndexTarget = embedModels.length === 0 ? "original" : opts.indexTarget;

    // Client-side dedupe: a file with the same name AND same size is almost
    // certainly identical. Skip the network round-trip (and the server's full
    // save→hash→delete cycle) for files already in the queue, whether from a
    // prior batch or repeated within this same drop. This also catches the
    // case of dropping the same folder twice. Same-name/different-size (a
    // legitimately different file that happens to share a name) is still sent.
    const seen = new Set(
      uploads.map((u) => `${u.name}::${u.size}`),
    );

    for (const file of arr) {
      const dedupeKey = `${file.name}::${file.size}`;
      if (seen.has(dedupeKey)) {
        const id = crypto.randomUUID();
        setUploads((prev) => [...prev, { id, name: file.name, size: file.size, status: "duplicate", progress: 100 }]);
        toast.info(t.documents.upload.duplicateSkipped.replace("{name}", file.name));
        continue;
      }
      seen.add(dedupeKey);

      const id = crypto.randomUUID();
      const item: UploadItem = { id, name: file.name, size: file.size, status: "converting", progress: 50 };
      setUploads((prev) => [...prev, item]);

      const fd = new FormData();
      fd.append("file", file);
      if (llmModel) fd.append("llmModelId", llmModel);
      if (embedModel) fd.append("embedModelId", embedModel);
      fd.append("splitStrategy", opts.splitStrategy);
      fd.append("indexTarget", effectiveIndexTarget);
      fd.append("indexMode", opts.indexMode);
      fd.append("autoSplit", String(opts.autoSplit));
      try {
        const res = await fetch("/api/v1/documents/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "complete", progress: 100, docId: data.data.document.id } : u));
        } else if (data.error === "DUPLICATE") {
          // Server detected an identical file (SHA-256 match). Mark it as a
          // duplicate rather than "complete" so the user sees it was skipped,
          // and do NOT attach a docId so it's excluded from "Start Processing".
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "duplicate", progress: 100 } : u));
          toast.info(t.documents.upload.duplicateSkipped.replace("{name}", file.name));
        } else {
          setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: data.error } : u));
        }
      } catch {
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: t.documents.upload.uploadFailed } : u));
      }
    }
  }, [llmModel, embedModel, knowledgeMode, embedModels.length, uploads, t]);

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
    // The pre-Start-Processing hint has served its purpose; clear it so the
    // submitted-batch hint (set below on success) is the one the user sees.
    setUploadedBatch(null);
    const opts = knowledgeModeToOptions(knowledgeMode);
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
                splitStrategy: opts.splitStrategy,
                indexTarget: embedModels.length === 0 ? "original" : opts.indexTarget,
                indexMode: opts.indexMode,
                wikiEnabled: opts.wikiEnabled,
                autoSplit: opts.autoSplit,
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
    if (success > 0) {
      if (fail === 0) {
        toast.success(`${success} ${t.documents.upload.queued}`);
      } else {
        toast.warning(`${success} ${t.documents.upload.queued}, ${fail} ${t.common.states.failed}`);
      }
      router.push("/library");
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
        {uploadedBatch && (
          <ProcessingNotice
            totalBytes={uploadedBatch.totalBytes}
            fileCount={uploadedBatch.fileCount}
            indexMode={knowledgeModeToOptions(knowledgeMode).indexMode}
            variant="queued"
          />
        )}
        <ProcessingSettings
          llmModels={llmModels} embedModels={embedModels}
          llmModel={llmModel} embedModel={embedModel}
          modelsLoaded={modelsLoaded}
          knowledgeMode={knowledgeMode}
          onLlmModelChange={setLlmModel} onEmbedModelChange={handleEmbedModelChange}
          onKnowledgeModeChange={setKnowledgeMode}
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
