"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { DocumentMeta, SearchResult } from "@/types/documents";
import { SearchHero } from "@/components/library/search-hero";
import { StatsRibbon } from "@/components/library/stats-ribbon";
import { DocumentTable } from "@/components/library/document-table";
import { SemanticResults } from "@/components/library/semantic-results";

type TabId = "documents" | "search";

const tabItems: { id: TabId; label: string }[] = [
  { id: "documents", label: "Document Management" },
  { id: "search", label: "Document Search" },
];

export default function LibraryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("documents");

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterFormat, setFilterFormat] = useState<string>("All");
  const [sortBy, setSortBy] = useState("Newest first");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [quickSearch, setQuickSearch] = useState("");
  const limit = 20;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const fetchDocs = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (sortBy === "Name A-Z") { params.set("sort", "originalName"); params.set("order", "asc"); }
    else if (sortBy === "Size") { params.set("sort", "originalSize"); params.set("order", "desc"); }
    else { params.set("sort", "createdAt"); params.set("order", "desc"); }
    if (filterFormat !== "All") params.set("format", filterFormat.toLowerCase());
    if (filterStatus !== "all") params.set("status", filterStatus);
    const res = await fetch(`/api/v1/library/documents?${params}`);
    const data = await res.json();
    if (data.success) { setDocuments(data.data); setTotal(data.total); }
    setLoading(false);
  }, [sortBy, filterFormat, filterStatus]);

  useEffect(() => { if (activeTab === "documents") fetchDocs(page); }, [page, activeTab, fetchDocs]);

  useEffect(() => {
    if (activeTab !== "documents") return;
    const hasProcessing = documents.some((d) =>
      ["uploading", "converting", "splitting", "embedding", "indexing"].includes(d.status)
    );
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocs(page), 5000);
    return () => clearInterval(interval);
  }, [activeTab, documents, page, fetchDocs]);

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document and all its chunks?")) return;
    try {
      const res = await fetch(`/api/v1/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) return;
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        setTotal((t) => t - 1);
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  async function handleBatchDelete(ids: string[]) {
    if (!confirm(`Delete ${ids.length} selected documents and all their chunks?`)) return;
    try {
      const res = await fetch("/api/v1/documents/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
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

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchStage(0);
    const isSemantic = searchMode === "semantic";
    const stages = isSemantic
      ? ["Initializing search engine...", "Embedding your query...", "Scanning knowledge graph...", "Ranking results..."]
      : ["Tokenizing query...", "Searching index...", "Ranking results..."];
    let stageIdx = 0;
    const advanceInterval = isSemantic ? 2500 : 800;
    searchTimerRef.current = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, stages.length - 1);
      setSearchStage(stageIdx);
    }, advanceInterval);
    try {
      const endpoint = searchMode === "keyword" ? "/api/v1/library/search/keyword" : "/api/v1/library/search/semantic";
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
      const data = await res.json();
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      if (data.success) { setSearchResults(data.data); }
      else { alert(data.error || "Search failed"); }
    } catch {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      alert("Network error or server unavailable.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchMode]);

  const statDocs = total || documents.length;
  const statChunks = documents.reduce((sum, d) => sum + (d.chunks?.length || 0), 0);
  const statReady = documents.filter((d) => d.status === "ready").length;
  const statIndexed = documents.length > 0 ? Math.round((statReady / documents.length) * 100) : 0;
  const statSize = documents.reduce((sum, d) => sum + d.originalSize, 0);
  const maxChunks = Math.max(1, ...documents.map((d) => d.chunks?.length || 0));

  const filteredDocs = quickSearch.trim()
    ? documents.filter((d) => d.originalName.toLowerCase().includes(quickSearch.toLowerCase()))
    : documents;

  return (
    <div>
      <Header title="Document Library" />
      <div className="p-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 font-sans cursor-pointer ${activeTab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "documents" && (
          <>
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
          </>
        )}

        {activeTab === "search" && (
          <>
            <SearchHero
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchMode={searchMode}
              setSearchMode={setSearchMode}
              onSearch={handleSearch}
              isSearching={isSearching}
            />
            <SemanticResults
              results={searchResults}
              isSearching={isSearching}
              searchMode={searchMode}
              searchStage={searchStage}
            />
          </>
        )}
      </div>
    </div>
  );
}
