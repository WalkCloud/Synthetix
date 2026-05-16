"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Reference {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
}

interface SectionAsset {
  id: string;
  type: string;
  title: string;
  status: string;
  mimeType?: string | null;
  prompt?: string | null;
}

interface DocumentItem {
  id: string;
  originalName: string;
}

interface ReferencePanelProps {
  references: Reference[];
  sectionNotes: string;
  onSectionNotesChange: (notes: string) => void;
  draftId: string;
  sectionId: string | null;
  sectionContent: string;
  sectionRagMode: string;
  sectionRagDocumentIds: string[];
  assets: SectionAsset[];
  onAssetChanged: () => void;
  onRagConfigChange: (ragMode: string, ragDocumentIds: string[]) => void;
  onInsertAsset?: (assetId: string) => void;
}

type ActiveDialog = null | "gen" | "mermaid";

export function ReferencePanel({
  references,
  sectionNotes,
  onSectionNotesChange,
  draftId,
  sectionId,
  sectionContent,
  sectionRagMode,
  sectionRagDocumentIds,
  assets,
  onAssetChanged,
  onRagConfigChange,
  onInsertAsset,
}: ReferencePanelProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  const [genPrompt, setGenPrompt] = useState("");
  const [genLoading, setGenLoading] = useState(false);

  const [mermaidPrompt, setMermaidPrompt] = useState("");
  const [mermaidLoading, setMermaidLoading] = useState(false);
  const [mermaidSuggesting, setMermaidSuggesting] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set(sectionRagDocumentIds));
  const [docsLoaded, setDocsLoaded] = useState(false);

  const [previewAsset, setPreviewAsset] = useState<SectionAsset | null>(null);
  const [renderVer, setRenderVer] = useState(0);

  const readyAssets = assets.filter((a) => a.status === "ready" || a.status === "pending" || a.status === "generating");
  const hasAssets = readyAssets.length > 0;

  useEffect(() => {
    setRenderVer((v) => v + 1);
  }, [assets]);

  useEffect(() => {
    setSelectedDocIds(new Set(sectionRagDocumentIds));
  }, [sectionRagDocumentIds]);

  useEffect(() => {
    if (sectionRagMode !== "manual") return;
    if (docsLoaded) return;
    fetch("/api/v1/documents?status=ready")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setDocuments(data.data || []);
        setDocsLoaded(true);
      })
      .catch(() => {});
  }, [sectionRagMode, docsLoaded]);

  function handleRagModeChange(mode: string) {
    onRagConfigChange(mode, mode === "manual" ? [...selectedDocIds] : []);
  }

  function handleDocToggle(docId: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      onRagConfigChange("manual", [...next]);
      return next;
    });
  }

  function openGen() {
    setActiveDialog("gen");
    setGenPrompt("");
  }

  async function openMermaid() {
    setActiveDialog("mermaid");
    setMermaidPrompt("");

    if (!sectionId || !sectionContent.trim()) return;

    setMermaidSuggesting(true);
    try {
      const res = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/suggest-mermaid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: sectionContent }),
        }
      );
      const data = await res.json();
      if (data.success && data.data?.suggestion) {
        setMermaidPrompt(data.data.suggestion);
      }
    } catch {
      // Silently fail — user can still type manually
    } finally {
      setMermaidSuggesting(false);
    }
  }

  function closeDialog() {
    setActiveDialog(null);
    setGenPrompt("");
    setMermaidPrompt("");
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !sectionId) return;

    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (hasAssets) fd.append("replaceAssetId", readyAssets[0].id);

      const res = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/upload-image`,
        { method: "POST", body: fd }
      );
      const data = await res.json();
      if (data.success) {
        onAssetChanged();
      } else {
        alert(data.error || "Upload failed");
      }
    } catch {
      alert("Upload request failed");
    } finally {
      setImportLoading(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function handleGen() {
    if (!sectionId || !genPrompt.trim()) return;
    setGenLoading(true);
    try {
      const res = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/manual-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: genPrompt.trim(),
            title: genPrompt.trim().slice(0, 50),
            replaceAssetId: hasAssets ? readyAssets[0].id : null,
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        closeDialog();
        onAssetChanged();
      } else {
        alert(data.error || "Image generation failed");
      }
    } catch {
      alert("Image generation request failed");
    } finally {
      setGenLoading(false);
    }
  }

  async function handleMermaid() {
    if (!sectionId || !mermaidPrompt.trim()) return;
    setMermaidLoading(true);
    try {
      const codeRes = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/mermaid-generate-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: mermaidPrompt.trim(),
          }),
        }
      );
      const codeData = await codeRes.json();
      console.log("[Mermaid] code gen response:", codeData);
      if (!codeData.success || !codeData.data?.code) {
        console.error("[Mermaid] code gen failed:", codeData.error);
        alert(codeData.error || "Mermaid code generation failed");
        return;
      }

      console.log("[Mermaid] code to render (first 500):", codeData.data.code.slice(0, 500));
      const renderRes = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/mermaid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: codeData.data.code,
            title: mermaidPrompt.trim().slice(0, 50) || "Mermaid Diagram",
            replaceAssetId: hasAssets ? readyAssets[0].id : null,
          }),
        }
      );
      const renderData = await renderRes.json();
      if (renderData.success) {
        closeDialog();
        onAssetChanged();
      } else {
        console.error("[Mermaid] render failed:", renderData.error);
        alert(renderData.error || "Mermaid rendering failed");
      }
    } catch (err) {
      console.error("[Mermaid] generation failed:", err);
      alert("Mermaid generation failed");
    } finally {
      setMermaidLoading(false);
    }
  }

  const ragModes: { value: string; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "manual", label: "Manual" },
    { value: "off", label: "Off" },
  ];

  return (
    <div className="bg-white border-l border-slate-200 p-5 overflow-y-auto h-full">
      {/* References */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold flex items-center gap-2 text-slate-900">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            References
            {sectionRagMode === "auto" && (
              <span className="text-[11px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full font-bold">
                {references.length}
              </span>
            )}
          </h4>

          {/* RAG Mode Toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {ragModes.map((m) => (
              <button
                key={m.value}
                onClick={() => handleRagModeChange(m.value)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-all ${
                  sectionRagMode === m.value
                    ? "bg-white text-primary-600 shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Manual mode: document selector */}
        {sectionRagMode === "manual" && (
          <div className="mb-3 p-2.5 border border-slate-200 rounded-xl bg-slate-50 max-h-48 overflow-y-auto">
            <p className="text-[11px] text-slate-500 mb-2">Select documents to use as references:</p>
            {documents.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-2">No documents available</p>
            ) : (
              documents.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2 py-1 px-1.5 hover:bg-white rounded-lg cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedDocIds.has(doc.id)}
                    onChange={() => handleDocToggle(doc.id)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs text-slate-700 truncate">{doc.originalName}</span>
                </label>
              ))
            )}
          </div>
        )}

        {/* Off mode: hint */}
        {sectionRagMode === "off" && (
          <div className="mb-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-[11px] text-slate-400">RAG is disabled for this section. No references will be retrieved during generation.</p>
          </div>
        )}

        {/* Auto mode: show references in fixed scrollable list */}
        {sectionRagMode === "auto" && (
          references.length === 0 ? (
            <div className="text-xs text-slate-400 py-4 text-center">
              References will appear after generation
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
              <div className="max-h-[calc(100vh-420px)] min-h-[80px] overflow-y-auto">
                <div className="p-2 space-y-2">
                  {references.map((ref, i) => (
                    <div
                      key={i}
                      className="p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:border-primary-400 transition-colors bg-white"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-800 truncate max-w-[70%]">{ref.documentName}</span>
                        <span className="text-[10px] text-primary-600 font-bold flex-shrink-0">{Math.round(ref.score * 100)}%</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed mt-1 line-clamp-2">
                        {ref.content.slice(0, 160)}
                      </p>
                      {ref.sourceInfo && (
                        <div className="text-[10px] text-slate-400 mt-1 truncate">{ref.sourceInfo}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {references.length > 3 && (
                <div className="px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-center">
                  <span className="text-[10px] text-slate-400">{references.length} references</span>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Images */}
      <div className="mb-5">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          Images
          {hasAssets && (
            <span className="text-[11px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full font-bold">
              {readyAssets.length}
            </span>
          )}
        </h4>

        {hasAssets ? (
          <div className="space-y-2 mb-3">
            {readyAssets.map((asset) => {
              const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${asset.id}/serve?v=${renderVer}`;
              return (
                <div key={asset.id} className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg bg-slate-50">
                  {asset.status === "ready" ? (
                    <button
                      type="button"
                      onClick={() => setPreviewAsset(asset)}
                      className="flex-shrink-0 w-12 h-12 rounded-md overflow-hidden bg-white border border-slate-100 cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all"
                    >
                      <img src={serveUrl} alt={asset.title} className="w-full h-full object-contain p-0.5" />
                    </button>
                  ) : (
                    <div className="flex-shrink-0 w-12 h-12 rounded-md bg-slate-100 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-slate-300 animate-spin">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{asset.title}</p>
                    <p className="text-[10px] text-slate-400">
                      {asset.type === "diagram" || asset.type === "svg" ? "Diagram" : asset.type === "mermaid" ? "Mermaid" : "Image"}
                      {" · "}{asset.status === "ready" ? "Ready" : "Generating..."}
                    </p>
                  </div>
                  {asset.status === "ready" && (
                    <div className="flex items-center gap-0.5">
                      {onInsertAsset && (
                        <button
                          type="button"
                          onClick={() => onInsertAsset(asset.id)}
                          className="p-1 rounded hover:bg-primary-50 text-slate-400 hover:text-primary-600 transition-colors cursor-pointer"
                          title="Insert into section"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewAsset(asset)}
                        className="p-1 rounded hover:bg-primary-50 text-slate-400 hover:text-primary-600 transition-colors cursor-pointer"
                        title="Preview"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mb-2.5">No images yet. Use Gen or Mermaid to add.</p>
        )}

        <div className="flex gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={openGen}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            Gen
          </button>
          <button
            onClick={openMermaid}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Mermaid
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importLoading}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
          >
            {importLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            Import
          </button>
        </div>

        {/* Gen Dialog */}
        {activeDialog === "gen" && (
          <div className="mt-3 p-3 border border-primary-200 rounded-xl bg-primary-50/50">
            <label className="text-xs font-semibold text-slate-700 mb-1 block">Prompt (English recommended)</label>
            <textarea
              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm mb-2"
              placeholder="A flowchart showing the CI/CD pipeline with build, test, and deploy stages..."
              rows={3}
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={handleGen}
                disabled={genLoading || !genPrompt.trim()}
                className="flex-1 px-2 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {genLoading ? "Generating..." : "Generate"}
              </button>
              <button
                onClick={closeDialog}
                className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Mermaid Dialog */}
        {activeDialog === "mermaid" && (
          <div className="mt-3 p-3 border border-primary-200 rounded-xl bg-primary-50/50">
            <label className="text-xs font-semibold text-slate-700 mb-1 block">Describe your diagram</label>
            <textarea
              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm mb-2"
              placeholder={mermaidSuggesting ? "Analyzing section content..." : "e.g. A flowchart showing user authentication: login form → validate → check 2FA → grant access or deny"}
              rows={3}
              value={mermaidPrompt}
              onChange={(e) => setMermaidPrompt(e.target.value)}
              disabled={mermaidSuggesting}
            />
            {mermaidSuggesting && (
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-primary-600">Generating suggestion based on section content...</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleMermaid}
                disabled={mermaidLoading || mermaidSuggesting || !mermaidPrompt.trim()}
                className="flex-1 px-2 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {mermaidLoading ? "Generating..." : "Generate"}
              </button>
              <button
                onClick={closeDialog}
                className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section Notes */}
      <div>
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Section Notes
        </h4>
        <textarea
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm"
          placeholder="Add notes for this section..."
          style={{ minHeight: "100px" }}
          value={sectionNotes}
          onChange={(e) => onSectionNotesChange(e.target.value)}
        />
      </div>

      {/* Image Preview Modal */}
      {previewAsset && sectionId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-3xl max-h-[85vh] w-[90vw] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-semibold text-slate-900 truncate">{previewAsset.title}</p>
                <p className="text-[11px] text-slate-400">
                  {previewAsset.type === "mermaid" ? "Mermaid" : previewAsset.type === "diagram" || previewAsset.type === "svg" ? "Diagram" : "Image"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {onInsertAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      onInsertAsset(previewAsset.id);
                      setPreviewAsset(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Insert
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewAsset(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Image */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
              <img
                src={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${previewAsset.id}/serve?v=${renderVer}`}
                alt={previewAsset.title}
                className="max-w-full max-h-[65vh] object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
