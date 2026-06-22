"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { renderAIContent } from "@/components/shared/markdown-renderer";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { useLocale } from "@/lib/i18n";
import { toast } from "sonner";

interface WikiDetail {
  id: string;
  type: string;
  title: string;
  slug: string;
  content: string;
  confidence: number;
  status: string;
  sourceRefs: Array<{ documentId: string; chunkId?: string; chunkIndex?: number; entityId?: string }>;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: Array<{ id: string; relation: string; target: { id: string; title: string; slug: string; type: string } }>;
  backlinks: Array<{ id: string; relation: string; source: { id: string; title: string; slug: string; type: string } }>;
}

export default function WikiDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const isZh = locale === "zh-CN";

  const [entry, setEntry] = useState<WikiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchEntry = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/wiki/entries/${params.id}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error(isZh ? "条目不存在" : "Entry not found");
          router.push("/wiki");
          return;
        }
        throw new Error("Failed to fetch");
      }
      const json = (await res.json()) as { data: WikiDetail };
      setEntry(json.data);
    } catch {
      toast.error(isZh ? "加载失败" : "Failed to load entry");
    } finally {
      setLoading(false);
    }
  }, [params.id, router, isZh]);

  useEffect(() => {
    void fetchEntry();
  }, [fetchEntry]);

  async function handleSave() {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/wiki/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(isZh ? "已保存" : "Saved");
      setEditing(false);
      void fetchEntry();
    } catch {
      toast.error(isZh ? "保存失败" : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <Header title={t.layout.sidebar.knowledgeBase} />
        <div className="p-8">
          <LoadingState message={isZh ? "加载中..." : "Loading..."} />
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div>
        <Header title={t.layout.sidebar.knowledgeBase} />
        <div className="p-8">
          <EmptyState
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /></svg>}
            title={isZh ? "未找到条目" : "Entry not found"}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title={entry.title} />
      <div className="p-6 md:p-8">
        {/* Header info bar */}
        <div className="flex items-center gap-3 mb-6 animate-fade-in-up">
          <TypeBadge type={entry.type} />
          <span className="text-sm text-muted-foreground">
            {isZh ? "置信度" : "Confidence"}:
            <span className="ml-1 font-bold tabular-nums text-foreground">
              {Math.round(entry.confidence * 100)}%
            </span>
          </span>
          {entry.status === "conflicting" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/35 dark:text-red-300 dark:border-red-900/40">
              {isZh ? "矛盾" : "Conflicting"}
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(entry.updatedAt).toLocaleDateString(isZh ? "zh-CN" : "en-US")}
          </span>
        </div>

        {/* Two-column layout: content + sidebar */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] gap-6">
          {/* Left: content */}
          <div className="animate-fade-in-up">
            <div className="bg-card border border-border rounded-2xl p-6">
              {editing ? (
                <div className="space-y-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full min-h-[400px] p-4 border border-input rounded-lg text-sm font-mono bg-background text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {saving ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存" : "Save")}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
                    >
                      {isZh ? "取消" : "Cancel"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {renderAIContent(entry.content)}
                  </div>
                  <div className="flex gap-2 mt-6 pt-4 border-t border-border">
                    <button
                      onClick={() => { setEditContent(entry.content); setEditing(true); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      {isZh ? "编辑" : "Edit"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: sidebar (sources + links) */}
          <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            {/* Source documents */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-3">
                {isZh ? "来源" : "Sources"}
              </h4>
              {entry.sourceRefs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {isZh ? "无来源记录" : "No sources recorded"}
                </p>
              ) : (
                <div className="space-y-2">
                  {entry.sourceRefs.map((ref, i) => (
                    <div key={i} className="rounded-lg bg-muted/30 p-2.5 border border-border">
                      <div className="text-xs font-medium text-foreground truncate">
                        {isZh ? "文档" : "Doc"}: {ref.documentId.slice(0, 8)}...
                      </div>
                      {ref.chunkIndex !== undefined && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {isZh ? `块 #${ref.chunkIndex}` : `Chunk #${ref.chunkIndex}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Related entries (outgoing links) */}
            {entry.links.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-3">
                  {isZh ? "关联条目" : "Related"}
                </h4>
                <div className="space-y-1.5">
                  {entry.links.map((link) => (
                    <button
                      key={link.id}
                      onClick={() => router.push(`/wiki/${link.target.id}`)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-secondary transition-colors"
                    >
                      <LinkIcon relation={link.relation} />
                      <span className="text-xs text-foreground truncate flex-1">
                        {link.target.title}
                      </span>
                      <TypeBadge type={link.target.type} small />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Backlinks */}
            {entry.backlinks.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-3">
                  {isZh ? "被引用" : "Referenced by"}
                </h4>
                <div className="space-y-1.5">
                  {entry.backlinks.map((link) => (
                    <button
                      key={link.id}
                      onClick={() => router.push(`/wiki/${link.source.id}`)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-secondary transition-colors"
                    >
                      <LinkIcon relation={link.relation} />
                      <span className="text-xs text-foreground truncate flex-1">
                        {link.source.title}
                      </span>
                      <TypeBadge type={link.source.type} small />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  const config: Record<string, { label: string; classes: string }> = {
    doc_summary: { label: "Summary", classes: "bg-violet-50 text-violet-600 border-violet-100 dark:bg-violet-950/35 dark:text-violet-300 dark:border-violet-900/40" },
    topic: { label: "Topic", classes: "bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-950/35 dark:text-blue-300 dark:border-blue-900/40" },
    concept: { label: "Concept", classes: "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/35 dark:text-emerald-300 dark:border-emerald-900/40" },
    claim: { label: "Claim", classes: "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-900/40" },
  };
  const c = config[type] || { label: type, classes: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`${small ? "text-[9px] px-1 py-0" : "text-[10px] px-1.5 py-0.5"} rounded-full font-bold border ${c.classes}`}>
      {c.label}
    </span>
  );
}

function LinkIcon({ relation }: { relation: string }) {
  const icons: Record<string, React.ReactNode> = {
    supports: <span className="text-emerald-500 text-xs">✓</span>,
    contradicts: <span className="text-red-500 text-xs">✗</span>,
    relates: <span className="text-muted-foreground text-xs">→</span>,
    derived_from: <span className="text-violet-500 text-xs">↓</span>,
  };
  return <>{icons[relation] || icons.relates}</>;
}
