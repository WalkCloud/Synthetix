"use client";

import { useState, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";

interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: "queued" | "converting" | "complete" | "failed";
  progress: number;
  docId?: string;
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} MB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

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
    txt: "bg-[#EEEEE9] text-[#52525B]",
  };
  return m[ext] || "bg-[#EEEEE9] text-[#52525B]";
}

export default function DocumentsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [llmModel, setLlmModel] = useState("Qwen2.5 7B");
  const [embedModel, setEmbedModel] = useState("Ollama (nomic-embed-text)");
  const [contextUsage, setContextUsage] = useState(45);
  const [splitStrategy, setSplitStrategy] = useState("structure-llm");
  const [indexTarget, setIndexTarget] = useState("full");
  const [autoSplit, setAutoSplit] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    for (const file of arr) {
      const id = crypto.randomUUID();
      const item: UploadItem = { id, name: file.name, size: file.size, status: "converting", progress: 50 };
      setUploads((prev) => [...prev, item]);

      const fd = new FormData();
      fd.append("file", file);
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
  }, []);

  function removeUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div>
      <Header title="Document Initialization" />
      <div className="p-8">
        {/* Upload Zone */}
        <div
          className="mb-6 border-2 border-dashed border-[#E4E4E7] rounded-[16px] p-12 text-center cursor-pointer transition-all hover:border-primary hover:bg-primary-50 animate-fade-in-up"
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
          <div className="bg-base-white border border-[#E4E4E7] rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E4E7]">
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
                  <div key={item.id} className="flex items-center gap-4 py-4 border-b border-[#F0F0F0] last:border-b-0">
                    <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${ic}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-foreground mb-1">{item.name}</div>
                      <div className="text-[12px] text-muted-foreground">{formatSize(item.size)}</div>
                      {item.status === "converting" && (
                        <div className="mt-2 w-full h-1.5 bg-[#EEEEE9] rounded-full overflow-hidden">
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
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#EEEEE9] text-[#52525B]">Queued</span>
                      )}
                      {item.status === "failed" && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#DC2626]">{item.error || "Failed"}</span>
                      )}
                    </div>
                    <button onClick={() => removeUpload(item.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#EEEEE9] hover:text-foreground transition-colors shrink-0">
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
        <div className="bg-base-white border border-[#E4E4E7] rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E4E7]">
            <h3 className="font-display text-[16px] font-semibold text-foreground">Processing Settings</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">LLM Model</label>
                <select className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>
                  <option>Qwen2.5 7B</option><option>GPT-4o</option><option>Claude Sonnet</option><option>Llama 3.1 8B</option><option>Mistral 7B</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Embedding Model</label>
                <select className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={embedModel} onChange={(e) => setEmbedModel(e.target.value)}>
                  <option>Ollama (nomic-embed-text)</option><option>OpenAI (text-embedding-3-small)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Max Context Usage</label>
                <div className="flex items-center gap-3">
                  <input type="range" min="10" max="100" value={contextUsage}
                    className="flex-1 h-2 bg-[#F0F0F0] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                    onChange={(e) => setContextUsage(Number(e.target.value))} />
                  <span className="text-[14px] font-semibold text-primary min-w-[36px] text-right">{contextUsage}%</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">Token-based safety threshold. Prompt, references, and output budget remain reserved.</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Split Strategy</label>
                <select className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={splitStrategy} onChange={(e) => setSplitStrategy(e.target.value)}>
                  <option value="structure-llm">Structure first + LLM semantic review</option>
                  <option value="heading-only">Heading and page boundaries only</option>
                  <option value="llm-only">LLM semantic split only</option>
                </select>
                <p className="text-[12px] text-muted-foreground mt-1">Uses headings, pages, tables, and then domain/topic correlation.</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Index Target</label>
                <select className="w-full px-3.5 py-2.5 border border-[#E4E4E7] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={indexTarget} onChange={(e) => setIndexTarget(e.target.value)}>
                  <option value="full">Original + chunks + LightRAG graph</option>
                  <option value="original">Original Markdown only</option>
                  <option value="chunks">Chunks only</option>
                </select>
                <p className="text-[12px] text-muted-foreground mt-1">Stores provenance for source file, page, heading path, block, and image assets.</p>
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-[13px] font-medium text-foreground mb-0.5">Auto-split and preserve provenance</label>
                    <p className="text-[12px] text-muted-foreground">Chunks documents over the token threshold and keeps source anchors for RAG/topology.</p>
                  </div>
                  <label className="relative w-11 h-6 cursor-pointer">
                    <input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} className="sr-only peer"/>
                    <span className="absolute inset-0 bg-[#E4E4E7] rounded-full transition-all duration-200 peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-[18px] after:h-[18px] after:bg-white after:rounded-full after:transition-transform after:duration-200 peer-checked:after:translate-x-5"/>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Start Processing */}
        <div className="flex justify-end animate-fade-in-up">
          <button className="inline-flex items-center gap-2 px-7 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light hover:shadow-lg hover:-translate-y-px transition-all text-base">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Start Processing
          </button>
        </div>
      </div>
    </div>
  );
}
