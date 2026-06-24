"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { DocumentMeta } from "@/types/documents";
import { StatsRibbon } from "@/components/library/stats-ribbon";
import { DocumentTable } from "@/components/library/document-table";
import { useLocale } from "@/lib/i18n";

export default function LibraryPage() {
  const router = useRouter();
  const { t, format, locale } = useLocale();

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterFormat, setFilterFormat] = useState<string>("All");
  const [sortBy, setSortBy] = useState("Newest first");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [quickSearch, setQuickSearch] = useState("");
  const limit = 20;

  const fetchDocs = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (sortBy === "Name A-Z") { params.set("sort", "originalName"); params.set("order", "asc"); }
    else if (sortBy === "Size") { params.set("sort", "originalSize"); params.set("order", "desc"); }
    else { params.set("sort", "createdAt"); params.set("order", "desc"); }
    if (filterFormat !== "All") params.set("format", filterFormat.toLowerCase());
    if (filterStatus !== "all") params.set("status", filterStatus);
    try {
      const res = await fetch(`/api/v1/library/documents?${params}`);
      const data = await res.json();
      if (data.success) { setDocuments(data.data); setTotal(data.total); }
    } catch {
      // Transient fetch failure (dev recompilation, network blip). The polling
      // interval will retry; keep the last successful data rather than clearing.
    } finally {
      setLoading(false);
    }
  }, [sortBy, filterFormat, filterStatus]);

  useEffect(() => { fetchDocs(page); }, [page, fetchDocs]);

  useEffect(() => {
    const hasProcessing = documents.some((d) =>
      ["uploading", "queued", "converting", "splitting", "embedding", "indexing"].includes(d.status)
    );
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocs(page), 5000);
    return () => clearInterval(interval);
  }, [documents, page, fetchDocs]);

  async function handleDelete(docId: string) {
    if (!confirm(t.library.deleteConfirm)) return;
    // Ask whether to also delete the document's Wiki entries
    const isZh = locale === "zh-CN";
    const deleteWiki = confirm(
      isZh
        ? "是否同时删除该文档提炼出的知识条目？\n点击确定删除知识条目，点击取消保留。"
        : "Also delete the Wiki entries distilled from this document?\nClick OK to delete, Cancel to keep them."
    );
    try {
      const res = await fetch(`/api/v1/documents/${docId}?deleteWiki=${deleteWiki}`, { method: "DELETE" });
      if (!res.ok) return;
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        setTotal((prev) => prev - 1);
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  async function handleBatchDelete(ids: string[]) {
    if (!confirm(format.template(t.library.batchDeleteConfirm, { count: ids.length }))) return;
    const isZh = locale === "zh-CN";
    const deleteWiki = confirm(
      isZh
        ? "是否同时删除这些文档提炼出的知识条目？\n点击确定删除知识条目，点击取消保留。"
        : "Also delete the Wiki entries distilled from these documents?\nClick OK to delete, Cancel to keep them."
    );
    try {
      const res = await fetch("/api/v1/documents/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, deleteWiki }),
      });
      if (!res.ok) return;
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) fetchDocs(page);
    } catch (e) {
      console.error("Batch delete failed:", e);
    }
  }

  async function handleReindex(docId: string) {
    const res = await fetch(`/api/v1/documents/${docId}/reprocess`, { method: "POST" });
    const data = await res.json();
    if (data.success) fetchDocs(page);
  }

  const statDocs = total || documents.length;
  const statChunks = useMemo(() => documents.reduce((sum, d) => sum + (d.chunks?.length || 0), 0), [documents]);
  const statReady = useMemo(() => documents.filter((d) => d.status === "ready").length, [documents]);
  const statIndexed = documents.length > 0 ? Math.round((statReady / documents.length) * 100) : 0;
  const statSize = useMemo(() => documents.reduce((sum, d) => sum + d.originalSize, 0), [documents]);
  const maxChunks = useMemo(() => Math.max(1, ...documents.map((d) => d.chunks?.length || 0)), [documents]);

  const filteredDocs = useMemo(() => quickSearch.trim()
    ? documents.filter((d) => d.originalName.toLowerCase().includes(quickSearch.toLowerCase()))
    : documents, [documents, quickSearch]);

  return (
    <div>
      <Header title={t.library.title} />
      <div className="p-8">
        <StatsRibbon
          docCount={statDocs}
          chunkCount={statChunks}
          indexedPct={statIndexed}
          totalSizeMb={(statSize / 1048576).toFixed(1)}
        />
        <DocumentTable
          documents={filteredDocs}
          loading={loading}
          filterFormat={filterFormat}
          setFilterFormat={(f) => { setFilterFormat(f); setPage(1); }}
          sortBy={sortBy}
          setSortBy={setSortBy}
          maxChunks={maxChunks}
          onDelete={handleDelete}
          onBatchDelete={handleBatchDelete}
          onReindex={handleReindex}
          onView={(id) => router.push(`/library/${id}`)}
          quickSearch={quickSearch}
          setQuickSearch={setQuickSearch}
          filterStatus={filterStatus}
          setFilterStatus={(s) => { setFilterStatus(s); setPage(1); }}
          totalCount={total}
        />
        {total > limit && (
          <div className="flex items-center justify-center gap-1 mt-6">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&laquo;</button>
            {Array.from({ length: Math.min(5, Math.ceil(total / limit)) }, (_, i) => {
              const totalPages = Math.ceil(total / limit);
              let p: number;
              if (totalPages <= 5) p = i + 1;
              else if (page <= 3) p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else p = page - 2 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`min-w-[36px] h-9 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${p === page ? "bg-primary text-white border-primary" : "border-border bg-card text-foreground hover:bg-secondary"}`}>{p}</button>
              );
            })}
            <button onClick={() => setPage(Math.min(Math.ceil(total / limit), page + 1))} disabled={page >= Math.ceil(total / limit)}
              className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&raquo;</button>
          </div>
        )}
      </div>
    </div>
  );
}
