import type { SearchResult } from "@/types/documents";
import type { SearchMode } from "@/lib/search/display-state";

export function getSearchResultBadge(result: SearchResult, mode: SearchMode, locale: string) {
  const isZh = locale === "zh-CN";
  const percent = Math.max(0, Math.min(100, Math.round((result.score || 0) * 100)));

  if (mode === "keyword") {
    return {
      text: isZh ? `${percent}% 命中` : `${percent}% hit`,
      className: "bg-muted text-muted-foreground",
    };
  }

  const semanticScore = typeof result.debug?.vectorScore === "number" ? result.debug.vectorScore : result.score;
  const semanticPercent = Math.max(0, Math.min(100, Math.round((semanticScore || 0) * 100)));

  if (semanticPercent >= 80) {
    return {
      text: isZh ? `${semanticPercent}% 匹配` : `${semanticPercent}% match`,
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    };
  }
  if (semanticPercent >= 60) {
    return {
      text: isZh ? `${semanticPercent}% 匹配` : `${semanticPercent}% match`,
      className: "bg-primary-100 text-primary",
    };
  }
  return {
    text: isZh ? `${semanticPercent}% 匹配` : `${semanticPercent}% match`,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
  };
}
