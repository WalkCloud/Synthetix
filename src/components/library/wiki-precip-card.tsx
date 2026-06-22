"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";

interface WikiStatsForDoc {
  total: number;
  docSummary: number;
  topics: number;
  concepts: number;
  claims: number;
}

/**
 * "Knowledge precipitated" card shown on the document detail Overview tab.
 * Shows how many Wiki entries were synthesized from THIS document, with a
 * link to browse them in the Wiki. Reuses the MetricCard visual pattern.
 */
export function WikiPrecipCard({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const isZh = locale === "zh-CN";
  const [stats, setStats] = useState<WikiStatsForDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/wiki/entries?q=${encodeURIComponent(documentId)}&limit=1`);
        if (!res.ok) return;
        const json = (await res.json()) as { data: { stats: WikiStatsForDoc } };
        if (!cancelled) setStats(json.data.stats);
      } catch {
        // Non-blocking — card just stays hidden
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [documentId]);

  if (loading || !stats || stats.total === 0) {
    // Don't render an empty card — keeps the Overview tab clean when there's
    // no synthesized knowledge yet (e.g. new doc, or wikiEnabled=false).
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/35 dark:text-violet-300 flex items-center justify-center">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          {isZh ? "知识沉淀" : "Knowledge Synthesized"}
        </h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {isZh ? `本文档已沉淀到知识库` : "Precipitated to knowledge base"}
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {stats.docSummary > 0 && (
          <CountPill color="violet" label={isZh ? "摘要" : "Summary"} count={stats.docSummary} />
        )}
        {stats.topics > 0 && (
          <CountPill color="blue" label={isZh ? "主题" : "Topics"} count={stats.topics} />
        )}
        {stats.concepts > 0 && (
          <CountPill color="emerald" label={isZh ? "概念" : "Concepts"} count={stats.concepts} />
        )}
        {stats.claims > 0 && (
          <CountPill color="amber" label={isZh ? "主张" : "Claims"} count={stats.claims} />
        )}

        <button
          onClick={() => router.push("/wiki")}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline ml-auto"
        >
          {isZh ? "在知识库中查看" : "View in knowledge base"}
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CountPill({ color, label, count }: { color: string; label: string; count: number }) {
  const classes: Record<string, string> = {
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/35 dark:text-violet-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${classes[color]}`}>
      <span className="font-bold tabular-nums">{count}</span>
      {label}
    </span>
  );
}
