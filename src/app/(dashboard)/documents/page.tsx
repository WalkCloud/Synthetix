"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: "queued" | "converting" | "complete" | "failed";
  progress: number;
  docId?: string;
  error?: string;
}

interface ModelOption {
  id: string;
  modelName: string;
  providerName: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} MB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function modelLabel(models: ModelOption[], id: string): string {
  const m = models.find((x) => x.id === id);
  return m ? `${m.modelName} (${m.providerName})` : "Select...";
}

const SPLIT_LABELS: Record<string, string> = {
  "structure-llm": "Structure first + LLM semantic review",
  "heading-only": "Heading and page boundaries only",
  "llm-only": "LLM semantic split only",
};

const INDEX_LABELS: Record<string, string> = {
  full: "Original + chunks + LightRAG graph",
  original: "Original Markdown only",
  chunks: "Chunks only",
};

function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

function getFileIconClass(ext: string): string {
  const m: Record<string, string> = {
    pdf: "bg-[#FEE2E2] text-[#DC2626]",
    docx: "bg-[#EFF6FF] text-[#2563EB]",
    xlsx: "bg-[#DCFCE7] text-[#16A34A]",
    pptx: "bg-[#FFF7ED] text-[#EA580C]",
    md: "bg-[#DCFCE7] text-[#16A34A]",
    html: "bg-[#FFF7ED] text-[#EA580C]",
    epub: "bg-[#EFF6FF] text-[#2563EB]",
    txt: "bg-[#F4F2EF] text-[#6B6560]",
  };
  return m[ext] || "bg-[#F4F2EF] text-[#6B6560]";
}

export default function DocumentsPage() {
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/v1/models/providers")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return;
        const llm: ModelOption[] = [];
        const embed: ModelOption[] = [];
        for (const p of data.data) {
          for (const m of p.models) {
            let caps: string[] = [];
            try { caps = JSON.parse(m.capabilities ?? "[]"); } catch { /* empty */ }
            const entry = { id: m.id, modelName: m.modelName, providerName: p.name };
            if (caps.some((c: string) => c === "embedding" || c === "embed")) {
              embed.push(entry);
            } else {
              llm.push(entry);
            }
          }
        }
        setLlmModels(llm);
        setEmbedModels(embed);
        if (llm.length > 0) setLlmModel(llm[0].id);
        if (embed.length > 0) setEmbedModel(embed[0].id);
      })
      .catch(() => {});
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
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
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: "failed", error: "Upload failed" } : u));
      }
    }
  }, [llmModel, embedModel, contextUsage, splitStrategy, indexTarget, indexMode, autoSplit]);

  function removeUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleProcess() {
    const ready = uploads.filter((u) => u.status === "complete" && u.docId);
    if (ready.length === 0) {
      toast.error("No completed uploads to process");
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
      toast.success(`${success} document(s) queued for processing`);
    } else {
      toast.warning(`${success} queued, ${fail} failed`);
    }
  }

  return (
    <div>
      <Header title="Document Initialization" />
      <div className="p-8">
        {/* Upload Zone */}
        <div
          className="mb-6 border-2 border-dashed border-[#E8E6E1] rounded-[16px] p-12 text-center cursor-pointer transition-all hover:border-primary hover:bg-primary-50 animate-fade-in-up"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md" multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-primary-light mb-3 mx-auto opacity-60">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <h3 className="text-[16px] font-semibold text-foreground mb-1">Drag & Drop files here or click to browse</h3>
          <p className="text-[14px] text-muted-foreground">Supports PDF, DOCX, PPTX, XLSX, HTML, EPUB</p>
        </div>

        {/* Upload Queue */}
        {uploads.length > 0 && (
          <div className="bg-base-white border border-[#E8E6E1] rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E6E1]">
              <h3 className="font-display text-[16px] font-semibold text-foreground">Upload Queue</h3>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary">
                {uploads.length} file{uploads.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="px-6 py-2">
              {uploads.map((item) => {
                const ext = getFileExt(item.name);
                const ic = getFileIconClass(ext);
                return (
                  <div key={item.id} className="flex items-center gap-4 py-4 border-b border-[#F4F2EF] last:border-b-0">
                    <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${ic}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-foreground mb-1">{item.name}</div>
                      <div className="text-[12px] text-muted-foreground">{formatSize(item.size)}</div>
                      {item.status === "converting" && (
                        <div className="mt-2 w-full h-1.5 bg-[#F4F2EF] rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-[140px] shrink-0">
                      {item.status === "converting" && (
                        <>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFF7ED] text-[#EA580C]">Converting...</span>
                          <span className="text-[13px] font-semibold text-primary">{item.progress}%</span>
                        </>
                      )}
                      {item.status === "complete" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#DCFCE7] text-[#16A34A]">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"/></svg>Complete
                        </span>
                      )}
                      {item.status === "queued" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#F4F2EF] text-[#6B6560]">Queued</span>
                      )}
                      {item.status === "failed" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#DC2626]">{item.error || "Failed"}</span>
                      )}
                    </div>
                    <button onClick={() => removeUpload(item.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#F4F2EF] hover:text-foreground transition-colors shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Processing Settings */}
        <div className="bg-base-white border border-[#E8E6E1] rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E6E1]">
            <h3 className="font-display text-[16px] font-semibold text-foreground">Processing Settings</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">LLM Model</label>
                <Select value={llmModel} onValueChange={(v) => setLlmModel(v!)}>
                  <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                    <SelectValue>{modelLabel(llmModels, llmModel)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {llmModels.length === 0 ? (
                      <SelectItem value="none" disabled>No models configured — add in Model Management</SelectItem>
                    ) : (
                      llmModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Embedding Model</label>
                <Select value={embedModel} onValueChange={(v) => setEmbedModel(v!)}>
                  <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                    <SelectValue>{modelLabel(embedModels, embedModel)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {embedModels.length === 0 ? (
                      <SelectItem value="none" disabled>No embedding models configured</SelectItem>
                    ) : (
                      embedModels.map((m) => <SelectItem key={m.id} value={m.id}>{m.modelName} ({m.providerName})</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Max Context Usage</label>
                <div className="flex items-center gap-3">
                  <input type="range" min="10" max="100" value={contextUsage}
                    className="flex-1 h-2 bg-[#F4F2EF] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                    onChange={(e) => setContextUsage(Number(e.target.value))} />
                  <span className="text-[14px] font-semibold text-primary min-w-[36px] text-right">{contextUsage}%</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">Token-based safety threshold. Prompt, references, and output budget remain reserved.</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Split Strategy</label>
                <Select value={splitStrategy} onValueChange={(v) => setSplitStrategy(v!)}>
                  <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                    <SelectValue>{SPLIT_LABELS[splitStrategy] ?? splitStrategy}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="structure-llm">Structure first + LLM semantic review</SelectItem>
                    <SelectItem value="heading-only">Heading and page boundaries only</SelectItem>
                    <SelectItem value="llm-only">LLM semantic split only</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground mt-1">Uses headings, pages, tables, and then domain/topic correlation.</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Index Target</label>
                <Select value={indexTarget} onValueChange={(v) => setIndexTarget(v!)}>
                  <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                    <SelectValue>{INDEX_LABELS[indexTarget] ?? indexTarget}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Original + chunks + LightRAG graph</SelectItem>
                    <SelectItem value="original">Original Markdown only</SelectItem>
                    <SelectItem value="chunks">Chunks only</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground mt-1">Stores provenance for source file, page, heading path, block, and image assets.</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Knowledge Graph</label>
                <Select value={indexMode} onValueChange={(v) => setIndexMode(v as "basic" | "graph")}>
                  <SelectTrigger className="w-full h-auto px-3.5 py-2.5 text-sm">
                    <SelectValue>{indexMode === "graph" ? "Entity extraction + knowledge graph" : "Chunk storage only (fast)"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Chunk storage only (fast)</SelectItem>
                    <SelectItem value="graph">Entity extraction + knowledge graph (slower, richer)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground mt-1">Graph mode extracts entities and relations for enhanced retrieval and topology.</p>
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-[13px] font-medium text-foreground mb-0.5">Auto-split and preserve provenance</label>
                    <p className="text-[12px] text-muted-foreground">Chunks documents over the token threshold and keeps source anchors for RAG/topology.</p>
                  </div>
                  <label className="relative w-11 h-6 cursor-pointer">
                    <input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} className="sr-only peer"/>
                    <span className="absolute inset-0 bg-[#E8E6E1] rounded-full transition-all duration-200 peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-[18px] after:h-[18px] after:bg-white after:rounded-full after:transition-transform after:duration-200 peer-checked:after:translate-x-5"/>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Start Processing */}
        {uploads.length > 0 && (
          <div className="flex justify-end animate-fade-in-up">
            <button
              onClick={handleProcess}
              disabled={processing || !uploads.some((u) => u.status === "complete")}
              className="inline-flex items-center gap-2 px-7 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light hover:shadow-lg hover:-translate-y-px transition-all text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Start Processing
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
