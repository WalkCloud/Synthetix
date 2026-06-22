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
  const { t, locale } = useLocale();
  const isZh = locale === "zh-CN";

  const [data, setData] = useState<WikiListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const limit = 20;

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/v1/wiki/entries?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = (await res.json()) as { data: WikiListResponse };
      setData(json.data);
    } catch {
      toast.error(isZh ? "加载失败" : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page, isZh]);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  // Client-side sort (data already fetched, sort locally)
  const sortedItems = (() => {
    if (!data) return [];
    const items = [...data.items];
    if (sortBy === "confidence") items.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "sources") items.sort((a, b) => b.sourceRefCount - a.sourceRefCount);
    else items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return items;
  })();

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
          <StatCell value={stats?.total ?? 0} label={isZh ? "知识条目" : "Entries"} color="primary" />
          <StatCell value={stats?.multiSource ?? 0} label={isZh ? "多源融合" : "Multi-Source"} color="blue" />
          <StatCell value={`${avgConfidence}%`} label={isZh ? "平均置信度" : "Avg Confidence"} color="emerald" />
          <StatCell
            value={stats?.totalSourceRefs ?? 0}
            label={isZh ? "来源引用" : "Source Refs"}
            color="amber"
          />
        </div>

        {/* Search + sort — no type filter pills (types shown as inline badges) */}
        <div className="flex items-center gap-3 flex-wrap mb-4 animate-fade-in-up">
          <div className="relative w-[200px]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={isZh ? "搜索知识..." : "Search knowledge..."}
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
            <option value="newest">{isZh ? "最近更新" : "Newest"}</option>
            <option value="confidence">{isZh ? "置信度优先" : "High confidence"}</option>
            <option value="sources">{isZh ? "多来源优先" : "Most sources"}</option>
          </select>
        </div>

        {/* Table container */}
        <div className="bg-card border border-border rounded-[16px] overflow-hidden">
          {loading ? (
            <LoadingState message={isZh ? "加载中..." : "Loading..."} />
          ) : !data || sortedItems.length === 0 ? (
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16 text-muted-foreground">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              }
              title={isZh ? "暂无知识条目" : "No knowledge entries yet"}
              description={
                isZh
                  ? "上传文档后，系统会自动从文档中提炼知识条目。"
                  : "Upload documents and the system will distill knowledge entries automatically."
              }
            />
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {[
                    { label: isZh ? "条目" : "Entry", style: "w-full" },
                    { label: isZh ? "置信度" : "Confidence", style: "w-[100px]" },
                    { label: isZh ? "来源" : "Sources", style: "w-[80px]" },
                    { label: isZh ? "更新" : "Updated", style: "w-[100px]" },
                    { label: "", style: "w-[44px]" },
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 py-3 bg-muted border-b border-border ${h.style} ${i === 0 ? "rounded-tl-[16px]" : ""} ${i === 4 ? "rounded-tr-[16px]" : ""}`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => router.push(`/wiki/${entry.id}`)}
                    className="border-b border-border last:border-b-0 hover:bg-primary/8 transition-colors cursor-pointer"
                  >
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
                        {new Date(entry.updatedAt).toLocaleDateString(isZh ? "zh-CN" : "en-US")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-muted-foreground">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </td>
                  </tr>
                ))}
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

