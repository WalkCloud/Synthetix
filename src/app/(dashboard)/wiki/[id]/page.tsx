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
  const { t, format } = useLocale();

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
          toast.error(t.wiki.detail.entryNotFoundToast);
          router.push("/wiki");
          return;
        }
        throw new Error("Failed to fetch");
      }
      const json = (await res.json()) as { data: WikiDetail };
      setEntry(json.data);
    } catch {
      toast.error(t.wiki.detail.loadFailedToast);
    } finally {
      setLoading(false);
    }
  }, [params.id, router, t.wiki.detail.entryNotFoundToast, t.wiki.detail.loadFailedToast]);

  useEffect(() => { void fetchEntry(); }, [fetchEntry]);

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
      toast.success(t.wiki.detail.savedToast);
      setEditing(false);
      void fetchEntry();
    } catch {
      toast.error(t.wiki.detail.saveFailedToast);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!confirm(format.template(t.wiki.detail.deleteConfirm, { title: entry.title }))) return;
    try {
      const res = await fetch(`/api/v1/wiki/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t.wiki.detail.deletedToast);
      router.push("/wiki");
    } catch {
      toast.error(t.wiki.detail.deleteFailedToast);
    }
  }

  if (loading) {
    return (
      <div>
        <Header title={t.layout.sidebar.knowledgeWiki} />
        <div className="p-8"><LoadingState message={t.wiki.detail.loading} /></div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div>
        <Header title={t.layout.sidebar.knowledgeWiki} />
        <div className="p-8">
          <EmptyState
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16"><circle cx="12" cy="12" r="10" /></svg>}
            title={t.wiki.detail.notFoundTitle}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title={entry.title} />
      <div className="p-6 md:p-8 space-y-6">
        {/* Detail fields — mirrors library/[id] DetailField grid pattern */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
            <DetailField label={t.wiki.detail.fieldConfidence} value={`${Math.round(entry.confidence * 100)}%`} />
            <DetailField label={t.wiki.detail.fieldLinked} value={String(entry.links.length)} />
            <DetailField label={t.wiki.detail.fieldUpdated} value={format.date(entry.updatedAt)} />
          </dl>
        </div>

        {/* Two-column layout: content + sidebar */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] gap-6">
          {/* Left: content */}
          <div className="bg-card border border-border rounded-2xl p-6">
            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-[400px] p-4 border border-input rounded-lg text-sm font-mono bg-background text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 resize-y"
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer">
                    {saving ? t.wiki.detail.saving : t.common.actions.save}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors cursor-pointer">
                    {t.common.actions.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {renderAIContent(entry.content)}
                </div>
                <div className="flex gap-2 mt-6 pt-4 border-t border-border">
                  <button onClick={() => { setEditContent(entry.content); setEditing(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {t.common.actions.edit}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    {t.common.actions.delete}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right: sidebar */}
          <div className="space-y-4">
            {/* Sources */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
                {t.wiki.detail.sources}
              </h4>
              {entry.sourceRefs.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.wiki.detail.noSources}</p>
              ) : (
                <div className="space-y-2">
                  {entry.sourceRefs.map((ref, i) => (
                    <div key={i} className="rounded-lg bg-muted/30 p-2.5 border border-border">
                      <div className="text-xs font-medium text-foreground truncate">
                        {t.wiki.detail.doc}: {ref.documentId.slice(0, 8)}…
                      </div>
                      {ref.chunkIndex !== undefined && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {format.template(t.wiki.detail.chunk, { n: ref.chunkIndex })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Related entries */}
            {entry.links.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
                  {t.wiki.detail.related}
                </h4>
                <div className="space-y-1">
                  {entry.links.map((link) => (
                    <button key={link.id} onClick={() => router.push(`/wiki/${link.target.id}`)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-secondary transition-colors cursor-pointer">
                      <LinkIcon relation={link.relation} />
                      <span className="text-xs text-foreground truncate flex-1">{link.target.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Backlinks */}
            {entry.backlinks.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3">
                  {t.wiki.detail.referencedBy}
                </h4>
                <div className="space-y-1">
                  {entry.backlinks.map((link) => (
                    <button key={link.id} onClick={() => router.push(`/wiki/${link.source.id}`)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-secondary transition-colors cursor-pointer">
                      <LinkIcon relation={link.relation} />
                      <span className="text-xs text-foreground truncate flex-1">{link.source.title}</span>
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

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
      <dd className="text-sm text-foreground font-medium">{value}</dd>
    </div>
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
