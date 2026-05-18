"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { DocumentMeta, SearchResult } from "@/types/documents";
import { SearchHero } from "@/components/library/search-hero";
import { StatsRibbon } from "@/components/library/stats-ribbon";
import { DocumentTable } from "@/components/library/document-table";
import { SemanticResults } from "@/components/library/semantic-results";

type TabId = "documents" | "semantic";

const tagColors: Record<string, string> = {
  Architecture: "bg-primary-100 text-primary",
  API: "bg-[#EFF6FF] text-[#2563EB]",
  REST: "bg-[#DCFCE7] text-[#16A34A]",
  Product: "bg-[#FFF7ED] text-[#EA580C]",
  Database: "bg-[#DCFCE7] text-[#16A34A]",
  DevOps: "bg-[#FFF7ED] text-[#EA580C]",
  Security: "bg-primary-100 text-primary",
};

export default function LibraryPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("documents");
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filterFormat, setFilterFormat] = useState<string>("All");
  const [sortBy, setSortBy] = useState("Newest first");
  const limit = 20;

  const fetchDocs = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (sortBy === "Name A-Z") { params.set("sort", "originalName"); params.set("order", "asc"); }
    else if (sortBy === "Size") { params.set("sort", "originalSize"); params.set("order", "desc"); }
    else { params.set("sort", "createdAt"); params.set("order", "desc"); }
    if (filterFormat !== "All") params.set("format", filterFormat.toLowerCase());
    const res = await fetch(`/api/v1/library/documents?${params}`);
    const data = await res.json();
    if (data.success) { setDocuments(data.data); setTotal(data.total); }
    setLoading(false);
  }, [sortBy, filterFormat]);

  useEffect(() => { if (tab === "documents") fetchDocs(page); }, [page, tab, fetchDocs]);

  useEffect(() => {
    if (tab !== "documents") return;
    const hasProcessing = documents.some((d) =>
      ["uploading", "converting", "splitting", "embedding", "indexing"].includes(d.status)
    );
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocs(page), 5000);
    return () => clearInterval(interval);
  }, [tab, documents, page, fetchDocs]);

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document and all its chunks?")) return;
    const res = await fetch(`/api/v1/documents/${docId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setTotal((t) => t - 1);
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
      if (data.success) { setSearchResults(data.data); setTab("semantic"); }
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

  return (
    <div>
      <Header title="Document Library" />
      <div className="p-8">
        <SearchHero
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          onSearch={handleSearch}
          isSearching={isSearching}
        />

        <StatsRibbon
          docCount={statDocs}
          chunkCount={statChunks}
          indexedPct={statIndexed}
          totalSizeMb={(statSize / 1048576).toFixed(1)}
        />

        <div className="flex gap-0 border-b border-[#E8E6E1] mb-6">
          {([
            { id: "documents" as TabId, label: "Documents" },
            { id: "semantic" as TabId, label: "Semantic Results" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 font-sans cursor-pointer ${tab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "documents" && (
          <>
            <DocumentTable
              documents={documents}
              loading={loading}
              filterFormat={filterFormat}
              setFilterFormat={(f) => { setFilterFormat(f); setPage(1); }}
              sortBy={sortBy}
              setSortBy={setSortBy}
              maxChunks={maxChunks}
              tagColors={tagColors}
              onDelete={handleDelete}
              onReindex={handleReindex}
              onView={(id) => router.push(`/library/${id}`)}
            />
            {total > limit && (
              <div className="flex items-center justify-center gap-1 mt-6">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="min-w-[36px] h-9 rounded-lg border border-[#E8E6E1] bg-white text-foreground text-sm font-medium cursor-pointer hover:bg-[#F4F2EF] disabled:opacity-40 disabled:cursor-not-allowed">&laquo;</button>
                {Array.from({ length: Math.min(5, Math.ceil(total / limit)) }, (_, i) => {
                  const totalPages = Math.ceil(total / limit);
                  let p: number;
                  if (totalPages <= 5) p = i + 1;
                  else if (page <= 3) p = i + 1;
                  else if (page >= totalPages - 2) p = totalPages - 4 + i;
                  else p = page - 2 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`min-w-[36px] h-9 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${p === page ? "bg-primary text-white border-primary" : "border-[#E8E6E1] bg-white text-foreground hover:bg-[#F4F2EF]"}`}>{p}</button>
                  );
                })}
                <button onClick={() => setPage(Math.min(Math.ceil(total / limit), page + 1))} disabled={page >= Math.ceil(total / limit)}
                  className="min-w-[36px] h-9 rounded-lg border border-[#E8E6E1] bg-white text-foreground text-sm font-medium cursor-pointer hover:bg-[#F4F2EF] disabled:opacity-40 disabled:cursor-not-allowed">&raquo;</button>
              </div>
            )}
          </>
        )}

        {tab === "semantic" && (
          <SemanticResults
            results={searchResults}
            isSearching={isSearching}
            searchMode={searchMode}
            searchStage={searchStage}
          />
        )}
      </div>
    </div>
  );
}
