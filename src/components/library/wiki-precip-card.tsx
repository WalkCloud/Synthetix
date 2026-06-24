"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";

interface WikiStatsForDoc {
  total: number;
  multiSource: number;
  totalSourceRefs: number;
}

/**
 * Knowledge distillation summary, integrated as a field in the Document
 * Details dl-grid (not a separate card). Shows entry count as a clickable
 * link to the Knowledge Wiki page. Hidden when no entries exist.
 */
export function WikiPrecipField({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [stats, setStats] = useState<WikiStatsForDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/wiki/entries?q=${encodeURIComponent(documentId)}&limit=1`);
        if (!res.ok) return;
        const json = (await res.json()) as { data: { stats: WikiStatsForDoc } };
        if (!cancelled) setStats(json.data.stats);
      } catch {
        // Non-blocking — field just doesn't render
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [documentId]);

  // Don't render if no entries (keeps the dl-grid clean)
  if (!stats || stats.total === 0) return null;

  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-1">
        {t.library.detail.distilled}
      </dt>
      <dd className="text-sm">
        <button
          onClick={() => router.push("/wiki")}
          className="inline-flex items-center gap-1 text-primary hover:underline font-medium cursor-pointer"
        >
          {stats.total} {t.wiki.list.statEntries}
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </dd>
    </div>
  );
}
