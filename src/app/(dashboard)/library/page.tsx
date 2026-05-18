"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatFileSize } from "@/lib/text/format-file-size";
import { getFileIconClass } from "@/lib/text/file-utils";
import type { DocumentMeta, SearchResult } from "@/types/documents";

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

  // Poll for status updates while any document is processing
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
    if (data.success) {
      fetchDocs(page);
    }
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
      if (data.success) {
        setSearchResults(data.data);
        setTab("semantic");
      } else {
        alert(data.error || "Search failed");
      }
    } catch (error) {
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
        {/* Search Hero */}
        <div className="rounded-[22px] border border-border p-8 mb-6 animate-fade-in-up"
          style={{ background: "linear-gradient(135deg, #F3F1FC 0%, #F4F2EF 50%, #FFFFFF 100%)" }}>
          <h3 className="font-display text-[20px] font-bold text-foreground mb-1">Search Your Knowledge Base</h3>
          <p className="text-[14px] text-muted-foreground mb-5">Find documents by keyword or ask questions with AI-powered semantic search</p>
          <div className="flex bg-white rounded-[16px] shadow-md border-2 border-[#E8E6E1] focus-within:border-primary transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 ml-4 my-auto text-muted-foreground shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search documents or ask a question..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 border-none px-4 py-4 text-[15px] outline-none bg-transparent font-sans text-foreground placeholder:text-muted-foreground" />
            <div className="flex items-center gap-0.5 p-1.5 bg-[#F4F2EF] rounded-[12px] my-1.5 mr-1.5">
              <button onClick={() => setSearchMode("keyword")}
                className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-all ${searchMode === "keyword" ? "bg-white text-primary shadow-sm" : "bg-transparent text-muted-foreground"}`}>Keyword</button>
              <button onClick={() => setSearchMode("semantic")}
                className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-all ${searchMode === "semantic" ? "bg-white text-primary shadow-sm" : "bg-transparent text-muted-foreground"}`}>Semantic</button>
            </div>
            <button onClick={handleSearch} disabled={isSearching} className="btn m-1.5 px-6 py-3 bg-primary text-white font-semibold rounded-[12px] hover:bg-primary-light transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[90px]">
              {isSearching ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                "Search"
              )}
            </button>
          </div>
        </div>

        {/* Stats Ribbon */}
        <div className="grid grid-cols-4 gap-4 mb-6 animate-fade-in-up">
          <div className="bg-white border border-[#E8E6E1] rounded-[12px] p-4 flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-primary-100 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div><div className="text-[22px] font-bold text-foreground font-display">{statDocs}</div><div className="text-xs text-muted-foreground">Documents</div></div>
          </div>
          <div className="bg-white border border-[#E8E6E1] rounded-[12px] p-4 flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-[#EFF6FF] text-[#2563EB]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </div>
            <div><div className="text-[22px] font-bold text-foreground font-display">{statChunks}</div><div className="text-xs text-muted-foreground">Chunks</div></div>
          </div>
          <div className="bg-white border border-[#E8E6E1] rounded-[12px] p-4 flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-[#DCFCE7] text-[#16A34A]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div><div className="text-[22px] font-bold text-foreground font-display">{statIndexed}%</div><div className="text-xs text-muted-foreground">Indexed</div></div>
          </div>
          <div className="bg-white border border-[#E8E6E1] rounded-[12px] p-4 flex items-center gap-3.5">
            <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-[#FEF3C7] text-[#D97706]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div><div className="text-[22px] font-bold text-foreground font-display">{(statSize / 1048576).toFixed(1)}</div><div className="text-xs text-muted-foreground">MB Total</div></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-[#E8E6E1] mb-6">
          {[
            { id: "documents" as TabId, label: "Documents" },
            { id: "semantic" as TabId, label: "Semantic Results" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors bg-transparent border-t-0 border-l-0 border-r-0 font-sans cursor-pointer ${tab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Documents Tab */}
        {tab === "documents" && (
          <div className="animate-fade-in-up">
            {/* Filter chips + sort */}
            <div className="flex items-center gap-2 flex-wrap mb-5">
              {["All", "PDF", "DOCX", "PPTX", "Markdown"].map((f) => (
                <button key={f} onClick={() => { setFilterFormat(f); setPage(1); }}
                  className={`px-3.5 py-1.5 rounded-full border text-[13px] font-medium cursor-pointer transition-all ${filterFormat === f ? "border-primary text-primary bg-primary-100" : "border-[#E8E6E1] bg-white text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary-50"}`}>{f}</button>
              ))}
              <span className="flex-1" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v!)}>
                <SelectTrigger className="h-auto px-3 py-1.5 border-[#E8E6E1] text-[13px] bg-white text-foreground font-sans cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Newest first">Newest first</SelectItem>
                  <SelectItem value="Name A-Z">Name A-Z</SelectItem>
                  <SelectItem value="Size">Size</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <div className="bg-white border border-[#E8E6E1] rounded-[16px] overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-muted-foreground">Loading...</div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16 text-muted-foreground mb-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <h3 className="text-lg font-semibold text-foreground mb-2">No documents found</h3>
                  <p className="text-sm text-muted-foreground max-w-[400px] mb-6">Upload documents to get started with your knowledge base.</p>
                  <Link href="/documents" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-colors text-sm">Upload Documents</Link>
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["Document", "Tags", "Chunks", "Size", "Indexed", "Date", ""].map((h) => (
                        <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 py-3 bg-[#F4F2EF] border-b border-[#E8E6E1] first:rounded-tl-[16px] last:rounded-tr-[16px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => {
                      const fmt = doc.originalFormat;
                      const ready = doc.status === "ready";
                      const chunkCount = doc.chunks?.length || 0;
                      const chunkPct = Math.min(100, Math.round((chunkCount / maxChunks) * 100));
                      return (
                        <tr key={doc.id} className="border-b border-[#F4F2EF] last:border-b-0 hover:bg-[#F3F1FC] transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${getFileIconClass(fmt)}`}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-foreground">{doc.originalName.replace(/\.[^.]+$/, "")}</div>
                                <div className="text-xs text-muted-foreground">{doc.originalName}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex gap-1 flex-wrap">
                              {doc.tags?.map((t) => (
                                <span key={t.id} className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium ${tagColors[t.name] || "bg-primary-100 text-primary"}`}>{t.name}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-[60px] h-1.5 bg-[#F4F2EF] rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${chunkPct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">{chunkCount}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-sm text-foreground">{formatFileSize(doc.originalSize)}</td>
                          <td className="px-4 py-3.5">
                            {ready ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#16A34A]">✓ Ready</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#D97706]"><span className="inline-block animate-spin">⟳</span> {doc.status}</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-sm text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex gap-1">
                              <button onClick={() => router.push(`/library/${doc.id}`)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#F4F2EF] hover:text-foreground transition-colors" title="View">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              </button>
                              <button onClick={() => handleReindex(doc.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#F4F2EF] hover:text-foreground transition-colors" title="Reindex">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                              </button>
                              <button onClick={() => handleDelete(doc.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#FEE2E2] hover:text-[#DC2626] transition-colors" title="Delete">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-center gap-1 mt-6">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="min-w-[36px] h-9 rounded-lg border border-[#E8E6E1] bg-white text-foreground text-sm font-medium cursor-pointer hover:bg-[#F4F2EF] disabled:opacity-40 disabled:cursor-not-allowed">&laquo;</button>
                {Array.from({ length: Math.min(5, Math.ceil(total / limit)) }, (_, i) => {
                  const totalPages = Math.ceil(total / limit);
                  let p: number;
                  if (totalPages <= 5) { p = i + 1; }
                  else if (page <= 3) { p = i + 1; }
                  else if (page >= totalPages - 2) { p = totalPages - 4 + i; }
                  else { p = page - 2 + i; }
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`min-w-[36px] h-9 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${p === page ? "bg-primary text-white border-primary" : "border-[#E8E6E1] bg-white text-foreground hover:bg-[#F4F2EF]"}`}>{p}</button>
                  );
                })}
                <button onClick={() => setPage(Math.min(Math.ceil(total / limit), page + 1))} disabled={page >= Math.ceil(total / limit)}
                  className="min-w-[36px] h-9 rounded-lg border border-[#E8E6E1] bg-white text-foreground text-sm font-medium cursor-pointer hover:bg-[#F4F2EF] disabled:opacity-40 disabled:cursor-not-allowed">&raquo;</button>
              </div>
            )}
          </div>
        )}

        {/* Semantic Results Tab */}
        {tab === "semantic" && (
          <div className="space-y-3 animate-fade-in-up">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-full max-w-2xl space-y-4 mb-8">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white border border-[#E8E6E1] rounded-[16px] p-5 animate-pulse">
                      <div className="flex justify-between items-center mb-3">
                        <div className="h-5 bg-[#F4F2EF] rounded-lg w-48" />
                        <div className="h-6 w-20 bg-primary-100 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-3.5 bg-[#F4F2EF] rounded w-full" />
                        <div className="h-3.5 bg-[#F4F2EF] rounded w-5/6" />
                        <div className="h-3.5 bg-[#F4F2EF] rounded w-4/6" />
                      </div>
                      <div className="flex gap-4 mt-3">
                        <div className="h-3 bg-[#F4F2EF] rounded w-24" />
                        <div className="h-3 bg-[#F4F2EF] rounded w-32" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="w-12 h-12 border-[3px] border-primary/20 rounded-full" />
                    <div className="absolute inset-0 w-12 h-12 border-[3px] border-transparent border-t-primary rounded-full animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="text-[15px] font-semibold text-foreground mb-1">
                      {searchMode === "semantic"
                        ? ["Initializing search engine...", "Embedding your query...", "Scanning knowledge graph...", "Ranking results..."][searchStage]
                        : ["Tokenizing query...", "Searching index...", "Ranking results..."][searchStage]}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {searchMode === "semantic" ? "Semantic search uses AI to understand your query deeply" : "Keyword search matches exact terms in your documents"}
                    </p>
                  </div>
                  {searchMode === "semantic" && (
                    <div className="flex gap-1.5 mt-1">
                      {[0, 1, 2, 3].map((s) => (
                        <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${s <= searchStage ? "bg-primary w-8" : "bg-[#E8E6E1] w-4"}`} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16 text-muted-foreground mb-4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <h3 className="text-lg font-semibold text-foreground mb-2">No search results</h3>
                <p className="text-sm text-muted-foreground">Try a different query or switch to keyword search.</p>
              </div>
            ) : (
              searchResults.map((r, i) => (
                <div key={i} className="bg-white border border-[#E8E6E1] rounded-[16px] p-5 hover:border-[#D4D4D8] transition-colors">
                  <div className="flex justify-between items-center mb-2.5">
                    <span className="font-semibold text-[15px] text-foreground">{r.documentName}</span>
                    {typeof r.score === "number" && r.score >= 0.85 ? (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#16A34A]">{Math.round(r.score * 100)}% match</span>
                    ) : typeof r.score === "number" && r.score >= 0.75 ? (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary-100 text-primary">{Math.round(r.score * 100)}% match</span>
                    ) : typeof r.score === "number" ? (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706]">{Math.round(r.score * 100)}% match</span>
                    ) : (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#F4F2EF] text-[#6B6560]">Keyword match</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {(() => {
                      const text = r.content.slice(0, 300);
                      const parts = text.split(/(\b(?:search|document|test|content)\b)/gi);
                      return parts.map((part, i) =>
                        /^(search|document|test|content)$/i.test(part)
                          ? <mark key={i} className="bg-[#F3F1FC] text-primary px-1 py-px rounded-sm">{part}</mark>
                          : part
                      );
                    })()}
                  </div>
                  <div className="flex gap-4 mt-2.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg> {r.chunkId}</span>
                    {r.title && <span>{r.title}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </div>

    </div>
  );
}
