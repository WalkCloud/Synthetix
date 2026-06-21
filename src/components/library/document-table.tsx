"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatFileSize } from "@/lib/text/format-file-size";
import { getFileIconClass } from "@/lib/text/file-utils";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/lib/i18n";
import type { DocumentMeta } from "@/types/documents";

interface DocumentTableProps {
  documents: DocumentMeta[];
  loading: boolean;
  filterFormat: string;
  setFilterFormat: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  maxChunks: number;
  onDelete: (docId: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onReindex: (docId: string) => void;
  onView: (docId: string) => void;
  quickSearch: string;
  setQuickSearch: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  totalCount: number;
}

export function DocumentTable({
  documents,
  loading,
  filterFormat,
  setFilterFormat,
  sortBy,
  setSortBy,
  maxChunks,
  onDelete,
  onBatchDelete,
  onReindex,
  onView,
  quickSearch,
  setQuickSearch,
  filterStatus,
  setFilterStatus,
  totalCount,
}: DocumentTableProps) {
  const { t, format } = useLocale();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => { setSelectedIds(new Set()); }, [documents]);

  const allSelected = documents.length > 0 && selectedIds.size === documents.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map((d) => d.id)));
    }
  }, [documents, allSelected]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    onBatchDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const activeFilters = [
    filterFormat !== "All" ? filterFormat : null,
    filterStatus !== "all" ? filterStatus : null,
  ].filter(Boolean);
  const statusLabels: Record<string, string> = {
    all: t.library.filters.allStatuses,
    ready: t.common.states.ready,
    uploading: t.documents.uploadQueue.uploading,
    queued: t.documents.uploadQueue.queued,
    converting: t.documents.uploadQueue.converting,
    splitting: t.documents.processing.splitStrategy,
    embedding: t.models.capabilities.embedding,
    indexing: t.common.states.processing,
    indexing_graph: t.common.states.indexingGraph,
    failed: t.common.states.failed,
  };
  const sortLabels: Record<string, string> = {
    "Newest first": t.library.sort.newest,
    "Name A-Z": t.library.sort.nameAsc,
    Size: t.library.sort.size,
  };

  return (
    <div className="animate-fade-in-up space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {["All", "PDF", "DOCX", "PPTX", "Markdown"].map((f) => (
          <button
            key={f}
            onClick={() => setFilterFormat(f)}
            className={`px-3.5 py-1.5 rounded-full border text-[13px] font-medium cursor-pointer transition-all ${filterFormat === f ? "border-primary text-primary bg-primary-100" : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary-50"}`}
          >
            {f === "All" ? t.common.states.all : f}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-[200px]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t.library.filters.search}
            value={quickSearch}
            onChange={(e) => setQuickSearch(e.target.value)}
            className="w-full py-2 pr-3 pl-9 border border-input rounded-lg shadow-sm text-[13px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v!)}>
          <SelectTrigger className="h-auto px-3 py-2 border-input text-[13px] bg-background text-foreground font-sans cursor-pointer w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{statusLabels.all}</SelectItem>
            <SelectItem value="ready">{statusLabels.ready}</SelectItem>
            <SelectItem value="uploading">{statusLabels.uploading}</SelectItem>
            <SelectItem value="queued">{statusLabels.queued}</SelectItem>
            <SelectItem value="converting">{statusLabels.converting}</SelectItem>
            <SelectItem value="splitting">{statusLabels.splitting}</SelectItem>
            <SelectItem value="embedding">{statusLabels.embedding}</SelectItem>
            <SelectItem value="indexing">{statusLabels.indexing}</SelectItem>
            <SelectItem value="indexing_graph">{statusLabels.indexing_graph}</SelectItem>
            <SelectItem value="failed">{statusLabels.failed}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v!)}>
          <SelectTrigger className="h-auto px-3 py-2 border-input text-[13px] bg-background text-foreground font-sans cursor-pointer w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Newest first">{sortLabels["Newest first"]}</SelectItem>
            <SelectItem value="Name A-Z">{sortLabels["Name A-Z"]}</SelectItem>
            <SelectItem value="Size">{sortLabels.Size}</SelectItem>
          </SelectContent>
        </Select>
        {selectedIds.size > 0 && (
          <div className="ml-auto flex items-center gap-1 animate-fade-in-up">
            <button
              onClick={handleBatchDelete}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 text-[13px] font-medium whitespace-nowrap shadow-sm transition-colors cursor-pointer"
              title={t.library.actions.deleteSelected}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              {t.library.actions.deleteSelected} {selectedIds.size}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
              title={t.library.actions.clearSelection}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {documents.length} / {totalCount} {t.dashboard.stats.documents}
          <span className="ml-1">
            ({activeFilters.join(" × ")})
          </span>
        </div>
      )}

      <div className="bg-card border border-border rounded-[16px] overflow-hidden">
          {loading ? (
            <LoadingState />
          ) : documents.length === 0 ? (
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              }
              title={t.library.empty}
              description={activeFilters.length > 0 ? t.library.emptyFilteredDesc : t.library.emptyUploadDesc}
              action={
                activeFilters.length > 0 ? undefined : (
                  <Link
                    href="/documents"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-colors text-sm"
                  >
                    {t.documents.upload.title}
                  </Link>
                )
              }
            />
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-[44px] px-4 py-3 bg-muted border-b border-border first:rounded-tl-[16px]">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-border text-primary accent-primary cursor-pointer"
                      />
                    </label>
                  </th>
                  {[
                    { label: t.topology.nodeTypes.document, style: "w-full max-w-[360px]" },
                    { label: t.library.table.chunks, style: "w-[100px]" },
                    { label: t.library.table.size, style: "w-[90px]" },
                    { label: t.library.actions.indexed, style: "w-[130px]" },
                    { label: t.library.actions.date, style: "w-[110px]" },
                    { label: "", style: "w-[112px]" },
                  ].map((h) => (
                    <th
                      key={h.label}
                      className={`text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 py-3 bg-muted border-b border-border first:rounded-tl-[16px] last:rounded-tr-[16px] ${h.style}`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const fmt = doc.originalFormat;
                  const ready = doc.status === "ready";
                  const chunkCount = doc.chunks?.length || 0;
                  const chunkPct = Math.min(100, Math.round((chunkCount / maxChunks) * 100));
                  const isSelected = selectedIds.has(doc.id);
                  return (
                    <tr
                      key={doc.id}
                      className={`border-b border-border last:border-b-0 transition-colors ${isSelected ? "bg-primary/6" : "hover:bg-primary/8"}`}
                    >
                      <td className="px-4 py-3.5">
                        <label className="flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(doc.id)}
                            className="w-4 h-4 rounded border-border text-primary accent-primary cursor-pointer"
                          />
                        </label>
                      </td>
                      <td className="px-4 py-3.5 max-w-[360px]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${getFileIconClass(fmt)}`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="w-[18px] h-[18px]"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onView(doc.id)}
                              className="block max-w-full text-left text-sm font-semibold text-foreground hover:text-primary transition-colors truncate cursor-pointer"
                              title={t.common.actions.view}
                            >
                              {doc.originalName.replace(/\.[^.]+$/, "")}
                            </button>
                            <div className="text-xs text-muted-foreground truncate">{doc.originalName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${chunkPct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{chunkCount}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-foreground">{formatFileSize(doc.originalSize)}</td>
                      <td className="px-4 py-3.5">
                        {ready ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300 whitespace-nowrap">
                            {t.common.states.ready}
                          </span>
                        ) : doc.status === "queued" ? (
                          // "Queued" sits between upload-finished and convert-started.
                          // The library API attaches queuePosition for these docs so
                          // the user can see "Waiting · 2 / 5" — i.e. 2nd in line out
                          // of 5 docs ahead of completion.
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 whitespace-nowrap">
                            <span className="inline-block">⏳</span>
                            {statusLabels.queued}
                            {doc.queuePosition
                              ? ` · ${doc.queuePosition.rank} / ${doc.queuePosition.total}`
                              : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300 whitespace-nowrap">
                            <span className="inline-block animate-spin">⟳</span> {statusLabels[doc.status] ?? doc.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                        {format.date(doc.createdAt)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex gap-1">
                          <button
                            onClick={() => onView(doc.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                            title={t.common.actions.view}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => onReindex(doc.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                            title={t.library.reindex}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                              <polyline points="23 4 23 10 17 10" />
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                            </svg>
                          </button>
                          <button
                            onClick={() => onDelete(doc.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-red-100 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title={t.common.actions.delete}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}
