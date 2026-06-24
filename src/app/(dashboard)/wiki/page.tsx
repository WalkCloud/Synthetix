"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { useLocale } from "@/lib/i18n";
import { toast } from "sonner";

interface WikiListItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  contentPreview: string;
  confidence: number;
  status: string;
  sourceRefCount: number;
  updatedAt: string;
}

interface WikiStats {
  total: number;
  docSummary: number;
  topics: number;
  concepts: number;
  claims: number;
  multiSource: number;
  totalSourceRefs: number;
}

interface WikiListResponse {
  items: WikiListItem[];
  total: number;
  page: number;
  limit: number;
  stats: WikiStats;
}

export default function WikiPage() {
  const router = useRouter();
  const { t, format, locale } = useLocale();
  const isZh = locale === "zh-CN";

  const [data, setData] = useState<WikiListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<{ id: string; name: string }[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [docFilterOpen, setDocFilterOpen] = useState(false);
  const limit = 20;

  // Load document list for the filter dropdown
  useEffect(() => {
    fetch("/api/v1/library/documents?page=1&limit=50&sort=createdAt&order=desc")
      .then((r) => r.json())
      .then((json) => {
        const docs = (json.data || []).map((d: { id: string; originalName: string }) => ({
          id: d.id,
          name: d.originalName.replace(/\.[^.]+$/, ""),
        }));
        setDocuments(docs);
      })
      .catch(() => {});
  }, []);

  // Client-side sort (data already fetched, sort locally)
  const sortedItems = (() => {
    if (!data) return [];
    const items = [...data.items];
    if (sortBy === "confidence") items.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "sources") items.sort((a, b) => b.sourceRefCount - a.sourceRefCount);
    else items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return items;
  })();

  // Reset selection when data changes (page/filter/search)
  useEffect(() => { setSelectedIds(new Set()); }, [data]);

  const allSelected = sortedItems.length > 0 && selectedIds.size === sortedItems.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedItems.map((i) => i.id)));
  }, [allSelected, sortedItems]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function handleBatchDelete() {
    if (!confirm(format.template(t.wiki.list.batchDeleteConfirm, { count: selectedIds.size }))) return;
    try {
      const res = await fetch("/api/v1/wiki/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(format.template(t.wiki.list.deletedToast, { count: selectedIds.size }));
      setSelectedIds(new Set());
      void fetchEntries();
    } catch {
      toast.error(t.wiki.list.deleteFailedToast);
    }
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      selectedDocIds.forEach((id) => params.append("documentId", id));
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/v1/wiki/entries?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = (await res.json()) as { data: WikiListResponse };
      setData(json.data);
    } catch {
      toast.error(t.wiki.list.loadFailedToast);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedDocIds, page, t.wiki.list.loadFailedToast]);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  const totalPages = data ? Math.ceil(data.total / limit) : 1;
  const stats = data?.stats;
  const avgConfidence = data && data.items.length > 0
    ? Math.round((data.items.reduce((s, i) => s + i.confidence, 0) / data.items.length) * 100)
    : 0;

  return (
    <div>
      <Header title={t.layout.sidebar.knowledgeWiki} />
      <div className="p-8">
        {/* Stats Ribbon — meaningful dimensions, not content-type split */}
        <div className="grid grid-cols-4 gap-4 mb-6 animate-fade-in-up">
          <StatCell value={stats?.total ?? 0} label={t.wiki.list.statEntries} color="primary" />
          <StatCell value={stats?.multiSource ?? 0} label={t.wiki.list.statMultiSource} color="blue" />
          <StatCell value={`${avgConfidence}%`} label={t.wiki.list.statAvgConfidence} color="emerald" />
          <StatCell
            value={stats?.totalSourceRefs ?? 0}
            label={t.wiki.list.statSourceRefs}
            color="amber"
          />
        </div>

        {/* Search + filter + sort */}
        <div className="flex items-center gap-3 flex-wrap mb-4 animate-fade-in-up">
          {/* Document filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setDocFilterOpen((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                selectedDocIds.length > 0
                  ? "border-primary text-primary bg-primary-100"
                  : "border-input bg-background text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {selectedDocIds.length > 0
                ? `${selectedDocIds.length} ${isZh ? "个文档" : "docs"}`
                : (isZh ? "全部文档" : "All docs")}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {docFilterOpen && (
              <>
                {/* Click-away overlay */}
                <div className="fixed inset-0 z-10" onClick={() => setDocFilterOpen(false)} />
                <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-border rounded-lg shadow-lg max-h-[300px] overflow-y-auto min-w-[260px]">
                  {documents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {isZh ? "暂无文档" : "No documents"}
                    </div>
                  ) : (
                    documents.map((doc) => {
                      const checked = selectedDocIds.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-[13px]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedDocIds((prev) =>
                                checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]
                              );
                              setPage(1);
                            }}
                            className="w-4 h-4 rounded border-border text-primary accent-primary cursor-pointer"
                          />
                          <span className="text-foreground truncate">{doc.name}</span>
                        </label>
                      );
                    })
                  )}
                  {selectedDocIds.length > 0 && (
                    <button
                      onClick={() => { setSelectedDocIds([]); setPage(1); }}
                      className="w-full text-left px-3 py-2 border-t border-border text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer"
                    >
                      {isZh ? "清除筛选" : "Clear filter"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="relative w-[200px]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t.wiki.list.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full py-2 pr-3 pl-9 border border-input rounded-lg shadow-sm text-[13px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-[13px] bg-background text-foreground cursor-pointer focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          >
            <option value="newest">{t.wiki.list.sortNewest}</option>
            <option value="confidence">{t.wiki.list.sortConfidence}</option>
            <option value="sources">{t.wiki.list.sortSources}</option>
          </select>
          {selectedIds.size > 0 && (
            <div className="ml-auto flex items-center gap-1 animate-fade-in-up">
              <button
                onClick={handleBatchDelete}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 text-[13px] font-medium whitespace-nowrap shadow-sm transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {t.wiki.list.deleteSelected} {selectedIds.size}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Table container */}
        <div className="bg-card border border-border rounded-[16px] overflow-hidden">
          {loading ? (
            <LoadingState message={t.wiki.list.loading} />
          ) : !data || sortedItems.length === 0 ? (
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16 text-muted-foreground">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              }
              title={t.wiki.list.emptyTitle}
              description={t.wiki.list.emptyDesc}
            />
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-[44px] px-4 py-3 bg-muted border-b border-border rounded-tl-[16px]">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-border text-primary accent-primary cursor-pointer"
                      />
                    </label>
                  </th>
                  {[
                    { label: t.wiki.list.colEntry, style: "w-full" },
                    { label: t.wiki.list.colConfidence, style: "w-[100px]" },
                    { label: t.wiki.list.colSources, style: "w-[80px]" },
                    { label: t.wiki.list.colUpdated, style: "w-[100px]" },
                    { label: "", style: "w-[44px] rounded-tr-[16px]" },
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 py-3 bg-muted border-b border-border ${h.style}`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((entry) => {
                  const isSelected = selectedIds.has(entry.id);
                  return (
                  <tr
                    key={entry.id}
                    onClick={() => router.push(`/wiki/${entry.id}`)}
                    className={`border-b border-border last:border-b-0 transition-colors cursor-pointer ${isSelected ? "bg-primary/6" : "hover:bg-primary/8"}`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <label className="flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(entry.id)}
                          className="w-4 h-4 rounded border-border text-primary accent-primary cursor-pointer"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground hover:text-primary transition-colors truncate">
                          {entry.title}
                        </span>
                        <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {entry.contentPreview}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-sm font-bold tabular-nums ${entry.confidence >= 0.85 ? "text-emerald-600 dark:text-emerald-400" : entry.confidence >= 0.7 ? "text-foreground" : "text-muted-foreground"}`}>
                        {Math.round(entry.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {entry.sourceRefCount}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-muted-foreground">
                        {format.date(entry.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-muted-foreground">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-6">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&laquo;</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
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
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
              className="min-w-[36px] h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium cursor-pointer hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed">&raquo;</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ value, label, color }: { value: number | string; label: string; color: string }) {
  const colors: Record<string, string> = {
    primary: "bg-primary-100 text-primary dark:bg-primary/15",
    blue: "bg-blue-100 dark:bg-blue-950/35 text-blue-700 dark:text-blue-300",
    emerald: "bg-emerald-100 dark:bg-emerald-950/35 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-100 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300",
  };
  const icons: Record<string, React.ReactNode> = {
    primary: <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />,
    blue: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    emerald: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
    amber: <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></>,
  };
  return (
    <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
      <div className={`w-[42px] h-[42px] rounded-[12px] flex items-center justify-center shrink-0 ${colors[color]}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
          {icons[color]}
        </svg>
      </div>
      <div>
        <div className="text-[22px] font-bold text-foreground font-display tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

