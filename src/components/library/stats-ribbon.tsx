"use client";

import { useLocale } from "@/lib/i18n";

interface StatsRibbonProps {
  docCount: number;
  chunkCount: number;
  totalSizeMb: string;
}

export function StatsRibbon({ docCount, chunkCount, totalSizeMb }: StatsRibbonProps) {
  const { t } = useLocale();
  // NOTE: a fourth "indexed %" card was removed. It showed ready-docs / total,
  // which dropped whenever graph extraction was running (those docs stay
  // "enhancing" not "ready") and the percent lingered low for hours — confusing
  // next to the per-row progress bars. The library list already shows per-doc
  // progress, so an aggregate readiness % was redundant and misleading.
  return (
    <div className="grid grid-cols-3 gap-4 mb-6 animate-fade-in-up">
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-primary-100 text-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{docCount}</div><div className="text-xs text-muted-foreground">{t.dashboard.stats.documents}</div></div>
      </div>
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-blue-100 dark:bg-blue-950/35 text-blue-700 dark:text-blue-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{chunkCount}</div><div className="text-xs text-muted-foreground">{t.library.table.chunks}</div></div>
      </div>
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-amber-100 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{totalSizeMb}</div><div className="text-xs text-muted-foreground">MB {t.models.usage.total}</div></div>
      </div>
    </div>
  );
}
