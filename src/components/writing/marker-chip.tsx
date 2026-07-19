"use client";

import { useLocale } from "@/lib/i18n";

interface MarkerChipProps {
  kind: "image" | "diagram";
  title: string;
  markerId: string;
  onClick?: (markerId: string, kind: "image" | "diagram") => void;
}

export function MarkerChip({ kind, title, markerId, onClick }: MarkerChipProps) {
  const { t } = useLocale();
  const icon = kind === "image" ? "🖼️" : "📊";
  const borderClass = kind === "image"
    ? "border-blue-300 bg-blue-50/50 hover:bg-blue-100/60"
    : "border-amber-300 bg-amber-50/50 hover:bg-amber-100/60";

  return (
    <button
      type="button"
      onClick={() => onClick?.(markerId, kind)}
      className={`my-2 w-full flex items-center gap-2 p-3 border border-dashed rounded-lg transition-colors text-left cursor-pointer ${borderClass}`}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground">{t.writing.diagram.clickToGenerate}</p>
      </div>
    </button>
  );
}
