"use client";

interface StatsRibbonProps {
  docCount: number;
  chunkCount: number;
  indexedPct: number;
  totalSizeMb: string;
}

export function StatsRibbon({ docCount, chunkCount, indexedPct, totalSizeMb }: StatsRibbonProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6 animate-fade-in-up">
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-primary-100 text-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{docCount}</div><div className="text-xs text-muted-foreground">Documents</div></div>
      </div>
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-blue-100 dark:bg-blue-950/35 text-blue-700 dark:text-blue-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{chunkCount}</div><div className="text-xs text-muted-foreground">Chunks</div></div>
      </div>
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-emerald-100 dark:bg-emerald-950/35 text-emerald-700 dark:text-emerald-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{indexedPct}%</div><div className="text-xs text-muted-foreground">Indexed</div></div>
      </div>
      <div className="bg-card border border-border rounded-[12px] p-4 flex items-center gap-3.5">
        <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center bg-amber-100 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div><div className="text-[22px] font-bold text-foreground font-display">{totalSizeMb}</div><div className="text-xs text-muted-foreground">MB Total</div></div>
      </div>
    </div>
  );
}
