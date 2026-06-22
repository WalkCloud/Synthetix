"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { useLocale } from "@/lib/i18n";
import { toast } from "sonner";

type EntryType = "doc_summary" | "topic" | "concept" | "claim";

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
  const [typeFilter, setTypeFilter] = useState<EntryType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("page", String(page));
      params.set("limit", "20");
      const res = await fetch(`/api/v1/wiki/entries?${params}`);
      if (!res.ok) throw new Error("Failed to fetch wiki entries");
      const json = (await res.json()) as { data: WikiListResponse };
      setData(json.data);
    } catch {
      toast.error(isZh ? "加载知识库失败" : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, searchQuery, page, isZh]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <div>
      <Header title={t.layout.sidebar.knowledgeBase} />
      <div className="p-8">
        {/* Stats Ribbon */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-fade-in-up">
            <StatCard
              label={isZh ? "文档摘要" : "Doc Summaries"}
              value={data.stats.docSummary}
              color="violet"
              icon={
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </>
              }
            />
            <StatCard
              label={isZh ? "主题" : "Topics"}
              value={data.stats.topics}
              color="blue"
              icon={
                <>
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                </>
              }
            />
            <StatCard
              label={isZh ? "概念" : "Concepts"}
              value={data.stats.concepts}
              color="emerald"
              icon={
                <>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </>
              }
            />
            <StatCard
              label={isZh ? "主张" : "Claims"}
              value={data.stats.claims}
              color="amber"
              icon={
                <>
                  <polyline points="20 6 9 17 4 12" />
                </>
              }
            />
          </div>
        )}

        {/* Filter + Search */}
        <div className="flex items-center gap-3 mb-6 animate-fade-in-up">
          <div className="flex gap-0.5 flex-wrap">
            <FilterPill
              active={typeFilter === null}
              onClick={() => { setTypeFilter(null); setPage(1); }}
            >
              {isZh ? "全部" : "All"}
            </FilterPill>
            <FilterPill
              active={typeFilter === "doc_summary"}
              onClick={() => { setTypeFilter("doc_summary"); setPage(1); }}
            >
              {isZh ? "文档摘要" : "Summaries"}
            </FilterPill>
            <FilterPill
              active={typeFilter === "topic"}
              onClick={() => { setTypeFilter("topic"); setPage(1); }}
            >
              {isZh ? "主题" : "Topics"}
            </FilterPill>
            <FilterPill
              active={typeFilter === "concept"}
              onClick={() => { setTypeFilter("concept"); setPage(1); }}
            >
              {isZh ? "概念" : "Concepts"}
            </FilterPill>
            <FilterPill
              active={typeFilter === "claim"}
              onClick={() => { setTypeFilter("claim"); setPage(1); }}
            >
              {isZh ? "主张" : "Claims"}
            </FilterPill>
          </div>
          <div className="relative flex-1 max-w-xs ml-auto">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder={isZh ? "搜索知识库..." : "Search knowledge base..."}
              className="w-full py-2 pr-3 pl-9 border border-input rounded-lg shadow-sm text-[13px] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Entries List */}
        {loading ? (
          <LoadingState message={isZh ? "加载中..." : "Loading..."} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            }
            title={isZh ? "知识库为空" : "Knowledge base is empty"}
            description={
              isZh
                ? "上传文档后，系统会自动提取并综合知识到这里。"
                : "Upload documents and the system will synthesize knowledge here automatically."
            }
          />
        ) : (
          <div className="space-y-3">
            {data.items.map((entry, i) => (
              <button
                key={entry.id}
                onClick={() => router.push(`/wiki/${entry.id}`)}
                className="w-full text-left bg-card border border-border rounded-[16px] p-5 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer animate-fade-in-up"
                style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h3 className="font-semibold text-[15px] text-foreground truncate">
                    {entry.title}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <TypeBadge type={entry.type} />
                    <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                      {Math.round(entry.confidence * 100)}%
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                  {entry.contentPreview}
                </p>
                <div className="flex items-center gap-4 mt-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    </svg>
                    {entry.sourceRefCount} {isZh ? "来源" : "sources"}
                  </span>
                  <span>{new Date(entry.updatedAt).toLocaleDateString(isZh ? "zh-CN" : "en-US")}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <PageButton onClick={() => setPage(page - 1)} disabled={page <= 1}>
              ‹
            </PageButton>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PageButton key={p} active={p === page} onClick={() => setPage(p)}>
                {p}
              </PageButton>
            ))}
            <PageButton onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
              ›
            </PageButton>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const colorClasses: Record<string, string> = {
    violet: "bg-violet-100 text-violet-600 dark:bg-violet-950/35 dark:text-violet-300",
    blue: "bg-blue-100 text-blue-600 dark:bg-blue-950/35 dark:text-blue-300",
    emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/35 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/35 dark:text-amber-300",
  };
  return (
    <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
      <div className={`w-[42px] h-[42px] rounded-[12px] flex items-center justify-center shrink-0 ${colorClasses[color]}`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {icon}
        </svg>
      </div>
      <div>
        <div className="text-[22px] font-bold font-display tabular-nums text-foreground leading-tight">
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full border text-[13px] font-medium transition-colors ${
        active
          ? "border-primary text-primary bg-primary-100 dark:bg-primary/15"
          : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary-50 dark:hover:bg-primary/5"
      }`}
    >
      {children}
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; classes: string }> = {
    doc_summary: { label: "Summary", classes: "bg-violet-50 text-violet-600 border-violet-100 dark:bg-violet-950/35 dark:text-violet-300 dark:border-violet-900/40" },
    topic: { label: "Topic", classes: "bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/35 dark:text-blue-300 dark:border-blue-900/40" },
    concept: { label: "Concept", classes: "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:border-emerald-900/40" },
    claim: { label: "Claim", classes: "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-900/40" },
  };
  const c = config[type] || { label: type, classes: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${c.classes}`}>
      {c.label}
    </span>
  );
}

function PageButton({ active, disabled, onClick, children }: { active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[36px] h-9 rounded-lg border text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-white border-primary"
          : "bg-card border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
      }`}
    >
      {children}
    </button>
  );
}
