"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { toast } from "sonner";
import type { RagReferenceView } from "@/lib/writing/reference-view";
import { buildDiagramGenerationPrompt } from "@/lib/writing/diagram-prompt";
import { getLocalizedError, useLocale } from "@/lib/i18n";

type Reference = RagReferenceView;

interface GroupedReferences {
  documentName: string;
  refs: (Reference & { _originalIndex: number })[];
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
  onInsertImage?: (url: string, alt: string) => void;
  activeMarker?: {
    markerId: string;
    kind: "image" | "diagram";
    params: Record<string, string>;
  } | null;
  onAssetConfirm?: (markerId: string, assetId: string) => void;
}

type GeneratingMethod = null | "gen" | "mermaid" | "import";

export function ReferencePanel({
  references,
  sectionNotes,
  onSectionNotesChange,
  draftId,
  sectionId,
  sectionRagMode,
  sectionRagDocumentIds,
  assets,
  onAssetChanged,
  onRagConfigChange,
  onInsertAsset,
  onInsertImage,
  activeMarker,
  onAssetConfirm,
}: ReferencePanelProps) {
  const { locale, t } = useLocale();
  const isZh = locale === "zh-CN";
  const [imagePrompt, setImagePrompt] = useState("");
  const [generatingMethod, setGeneratingMethod] = useState<GeneratingMethod>(null);
  const [workspaceAssetId, setWorkspaceAssetId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set(sectionRagDocumentIds));
  const [docsLoaded, setDocsLoaded] = useState(false);

  const [previewAsset, setPreviewAsset] = useState<SectionAsset | null>(null);
  const [renderVer, setRenderVer] = useState(0);

  const readyAssets = assets.filter((a) => a.status === "ready");

  useEffect(() => {
    setRenderVer((v) => v + 1);
  }, [assets]);

  useEffect(() => {
    if (activeMarker) {
      setImagePrompt(buildDiagramGenerationPrompt(activeMarker.params));
      setWorkspaceAssetId(null);
    }
  }, [activeMarker]);

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

  async function handleGen() {
    if (!sectionId || !imagePrompt.trim()) return;
    setGeneratingMethod("gen");
    try {
      const res = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/generate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: imagePrompt.trim(),
            title: imagePrompt.trim().slice(0, 50),
            markerId: activeMarker?.markerId,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Image generation failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let newAssetId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "error") {
              toast.error(getLocalizedError(data));
            } else if (data.type === "complete" && data.assetId) {
              newAssetId = data.assetId;
            }
          } catch {}
        }
      }

      await onAssetChanged();
      if (newAssetId) setWorkspaceAssetId(newAssetId);
    } catch (err) {
      toast.error(getLocalizedError({ error: err instanceof Error ? err.message : undefined }));
    } finally {
      setGeneratingMethod(null);
    }
  }

  async function handleMermaid() {
    if (!sectionId || !imagePrompt.trim()) return;
    setGeneratingMethod("mermaid");
    try {
      const prompt = imagePrompt.trim();
      const codeRes = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/mermaid-generate-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        }
      );
      const codeData = await codeRes.json();
      if (!codeData.success || !codeData.data?.code) {
        toast.error(getLocalizedError(codeData));
        return;
      }

      const renderRes = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/mermaid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: codeData.data.code,
            title: imagePrompt.trim().slice(0, 50) || "Diagram",
            skipAppend: !!activeMarker,
          }),
        }
      );
      const renderData = await renderRes.json();
      if (renderData.success) {
        await onAssetChanged();
        setWorkspaceAssetId(renderData.data?.assetId);
      } else {
        toast.error(getLocalizedError(renderData));
      }
    } catch {
      toast.error(isZh ? "图表生成发生异常，请重试。" : "An unexpected chart generation error occurred. Please try again.");
    } finally {
      setGeneratingMethod(null);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !sectionId) return;

    setGeneratingMethod("import");
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(
        `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/upload-image`,
        { method: "POST", body: fd }
      );
      const data = await res.json();
      if (data.success) {
        await onAssetChanged();
        setWorkspaceAssetId(data.data?.assetId);
      } else {
        toast.error(getLocalizedError(data));
      }
    } catch {
      toast.error(isZh ? "上传请求失败" : "Upload request failed");
    } finally {
      setGeneratingMethod(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  const groupedReferences: GroupedReferences[] = useMemo(() => {
    const map = new Map<string, (Reference & { _originalIndex: number })[]>();
    references.forEach((ref, i) => {
      const key = ref.documentName || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ ...ref, _originalIndex: i });
    });
    return Array.from(map.entries()).map(([documentName, refs]) => ({ documentName, refs }));
  }, [references]);

  const allRefImages = useMemo(() => references.flatMap((ref) => ref.images || []), [references]);
  const referencesWithImages = useMemo(() => references.filter((ref) => ref.images && ref.images.length > 0), [references]);

  const ragModes: { value: string; label: string }[] = [
    { value: "auto", label: t.writing.documentLanguage.auto },
    { value: "manual", label: isZh ? "手动" : "Manual" },
    { value: "off", label: isZh ? "关闭" : "Off" },
  ];

  function referenceBadge(ref: Reference) {
    if (ref.sourceType === "rag_graph") {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-50 text-amber-600 border border-amber-100">
          Graph
        </span>
      );
    }
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-600 border border-blue-100">
        RAG
      </span>
    );
  }

  return (
    <div className="bg-card border-l border-border h-full flex flex-col">
      <div className="p-5 overflow-y-auto flex-1">

      {/* References */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {isZh ? "RAG 参考资料" : "RAG References"}
            </span>
            {references.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-600">{references.length}</span>
            )}
          </div>
          <div className="flex bg-secondary rounded-lg p-0.5">
            {ragModes.map((m) => (
              <button
                key={m.value}
                onClick={() => handleRagModeChange(m.value)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-all ${
                  sectionRagMode === m.value
                    ? "bg-card text-blue-600 shadow-sm"
                    : "text-muted-foreground hover:text-muted-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {sectionRagMode === "manual" && (
          <div className="mb-3 p-2.5 border border-border rounded-xl bg-muted/50 max-h-48 overflow-y-auto">
            <p className="text-[11px] text-muted-foreground mb-2">{isZh ? "选择要用作参考资料的文档：" : "Select documents to use as references:"}</p>
            {documents.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-2">{isZh ? "暂无可用文档" : "No documents available"}</p>
            ) : (
              documents.map((doc) => (
                <label key={doc.id} className="flex items-center gap-2 py-1 px-1.5 hover:bg-card rounded-lg cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedDocIds.has(doc.id)}
                    onChange={() => handleDocToggle(doc.id)}
                    className="w-3.5 h-3.5 rounded border-border text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-foreground/75 truncate">{doc.originalName}</span>
                </label>
              ))
            )}
          </div>
        )}

        {sectionRagMode === "off" && (
          <div className="mb-3 px-3 py-2 bg-muted/50 border border-border rounded-xl">
            <p className="text-[11px] text-muted-foreground">{isZh ? "该章节已关闭 RAG，生成时不会检索参考资料。" : "RAG is disabled for this section. No references will be retrieved during generation."}</p>
          </div>
        )}

        {sectionRagMode !== "off" && (
          references.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              {t.writing.referencePanel.noReferencesDesc}
            </div>
          ) : (
            <div className="border border-border rounded-xl bg-muted/50 overflow-hidden">
              <div className="max-h-[calc(100vh-460px)] min-h-[80px] overflow-y-auto">
                {groupedReferences.map((group, gi) => (
                  <div key={gi} className={gi > 0 ? "border-t border-border/60" : ""}>
                    {groupedReferences.length > 1 && (
                      <div className="px-2.5 pt-2 pb-1 flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 text-muted-foreground flex-shrink-0">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="text-[10px] font-semibold text-muted-foreground truncate">{group.documentName}</span>
                        <span className="text-[9px] text-muted-foreground flex-shrink-0">({group.refs.length})</span>
                      </div>
                    )}
                    <div className="px-2 pb-2 space-y-1.5">
                      {group.refs.map((ref) => (
                        <div
                          key={ref._originalIndex}
                          className="p-2 border border-border rounded-lg cursor-pointer hover:border-blue-400 transition-colors bg-card"
                        >
                          <div className="flex justify-between items-center">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-foreground truncate">
                                {ref.title || ref.sourceInfo || ref.documentName}
                              </span>
                              {referenceBadge(ref)}
                            </div>
                            <span className="text-[10px] text-blue-600 font-bold flex-shrink-0 ml-2">{Math.round(ref.score * 100)}%</span>
                          </div>
                          {ref.content && (
                            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 line-clamp-2">
                              {ref.content.slice(0, 160)}
                            </p>
                          )}
                          {groupedReferences.length <= 1 && ref.sourceInfo && (
                            <div className="text-[10px] text-muted-foreground mt-1 truncate">{ref.sourceInfo}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {references.length > 3 && (
                <div className="px-3 py-1.5 border-t border-border bg-muted/50 text-center">
                  <span className="text-[10px] text-muted-foreground">
                    {isZh ? `${references.length} 条参考，来自 ${groupedReferences.length} 个文档` : `${references.length} references from ${groupedReferences.length} document${groupedReferences.length > 1 ? "s" : ""}`}
                  </span>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {referencesWithImages.length > 0 && (
        <div className="mb-5 border-t border-border pt-4">
          <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
            <span>📷</span>
            <span>{isZh ? "参考图片" : "Ref Images"} ({allRefImages.length})</span>
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {allRefImages.map((img, idx) => (
              <div key={idx} className="rounded border border-border overflow-hidden">
                <div className="aspect-square bg-secondary flex items-center justify-center">
                  <Image
                    src={img.url}
                    alt={img.altText || ""}
                    width={160}
                    height={160}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                    unoptimized
                  />
                </div>
                <div className="p-1.5">
                  <p className="text-[11px] text-muted-foreground truncate">{img.altText || img.filename}</p>
                  {onInsertImage && (
                    <button
                      type="button"
                      className="text-[11px] text-primary-600 hover:underline mt-0.5"
                      onClick={() => onInsertImage(img.url, img.altText || "")}
                    >
                      {isZh ? "插入" : "Insert"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Images */}
      <div className="mb-5">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          {t.writing.assets.images}
          {activeMarker && (
            <span className="text-[11px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full font-bold">
              {activeMarker.params.title || activeMarker.markerId}
            </span>
          )}
        </h4>

        {/* Preview Area */}
        {sectionId && (() => {
          const previewTarget = workspaceAssetId
            ? assets.find((a) => a.id === workspaceAssetId)
            : null;

          if (previewTarget) {
            const isReady = previewTarget.status === "ready";
            const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${previewTarget.id}/serve?v=${renderVer}`;

            return (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => isReady && setPreviewAsset(previewTarget)}
                  disabled={!isReady}
                  className={`w-full rounded-xl overflow-hidden border border-border bg-muted/50 ${isReady ? "cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all" : "cursor-default"}`}
                >
                  {isReady ? (
                    <Image src={serveUrl} alt={previewTarget.title} width={600} height={320} className="h-auto max-h-[200px] w-full object-contain bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]" unoptimized />
                  ) : (
                    <div className="h-[120px] flex flex-col items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-[11px] text-muted-foreground">{t.writing.assets.generating}...</span>
                    </div>
                  )}
                </button>
                <p className="text-[11px] text-muted-foreground text-center mt-1 truncate">{previewTarget.title}</p>
              </div>
            );
          }

          return (
            <div className="mb-3 rounded-xl border border-dashed border-border bg-muted/30 h-[100px] flex items-center justify-center">
              <p className="text-[11px] text-muted-foreground">{isZh ? "生成后将在此处显示预览" : "Preview will appear here after generation"}</p>
            </div>
          );
        })()}

        {/* Prompt */}
        <textarea
          className="w-full px-2.5 py-1.5 border border-border rounded-lg text-xs text-foreground/75 bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm mb-2.5"
          placeholder={isZh ? "描述你想生成的图片或图表..." : "Describe the image or diagram you want to generate..."}
          rows={3}
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
        />

        {/* Three Action Buttons */}
        <input
          ref={importInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImportFile}
        />
        <div className="flex gap-2 mb-3">
          <button
            onClick={handleGen}
            disabled={generatingMethod !== null || !imagePrompt.trim()}
            title={isZh ? "使用 AI 文生图模型生成图片" : "Generate an image with an AI text-to-image model"}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generatingMethod === "gen" ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            )}
            Gen
          </button>
          <button
            onClick={handleMermaid}
            disabled={generatingMethod !== null || !imagePrompt.trim()}
            title={isZh ? "使用 LLM 生成 SVG 图表" : "Generate an SVG chart with an LLM"}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generatingMethod === "mermaid" ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            Mermaid
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={generatingMethod !== null}
            title={isZh ? "从本机上传图片" : "Upload an image from your device"}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300 transition-colors cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generatingMethod === "import" ? (
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            {isZh ? "导入" : "Import"}
          </button>
        </div>

        {/* Insert Button */}
        {activeMarker && onAssetConfirm && workspaceAssetId && (() => {
          const target = assets.find((a) => a.id === workspaceAssetId);
          if (!target || target.status !== "ready") return null;
          return (
            <button
              type="button"
              onClick={() => onAssetConfirm(activeMarker.markerId, workspaceAssetId!)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-xl text-xs font-semibold hover:bg-primary-700 transition-colors cursor-pointer shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {isZh ? "插入" : "Insert"}
            </button>
          );
        })()}

        {/* Asset history when no activeMarker */}
        {!activeMarker && readyAssets.length > 0 && (
          <div className="border-t border-border pt-3 mt-3">
            <p className="text-[11px] text-muted-foreground mb-2">{isZh ? "历史记录" : "History"} ({readyAssets.length})</p>
            <div className="space-y-1.5">
              {readyAssets.map((asset) => {
                const serveUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${asset.id}/serve?v=${renderVer}`;
                return (
                  <div key={asset.id} className="flex items-center gap-2 p-1.5 border border-border rounded-lg bg-muted/50">
                    <button
                      type="button"
                      onClick={() => setPreviewAsset(asset)}
                      className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden bg-card border border-border cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all"
                    >
                      <Image src={serveUrl} alt={asset.title} width={40} height={40} className="h-full w-full object-contain p-0.5" unoptimized />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground/75 truncate">{asset.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {asset.type === "mermaid" ? (isZh ? "图表" : "Chart") : t.writing.assets.images}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {onInsertAsset && (
                        <button
                          type="button"
                          onClick={() => onInsertAsset(asset.id)}
                          className="p-1 rounded hover:bg-primary-50 text-muted-foreground hover:text-primary-600 transition-colors cursor-pointer"
                          title={t.writing.referencePanel.insertIntoSection}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Section Notes */}
      <div>
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          {isZh ? "章节备注" : "Section Notes"}
        </h4>
        <textarea
          className="w-full px-3 py-2 border border-border rounded-lg text-[13px] text-foreground/75 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm"
          placeholder={isZh ? "为该章节添加备注..." : "Add notes for this section..."}
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
            className="relative bg-card rounded-2xl shadow-2xl max-w-3xl max-h-[85vh] w-[90vw] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-semibold text-foreground truncate">{previewAsset.title}</p>
                <p className="text-[11px] text-muted-foreground">
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
                    {isZh ? "插入" : "Insert"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewAsset(null)}
                  className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Image */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
              <Image
                src={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${previewAsset.id}/serve?v=${renderVer}`}
                alt={previewAsset.title}
                width={1200}
                height={800}
                className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-lg"
                unoptimized
              />
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
