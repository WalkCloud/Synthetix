import type { SearchResult } from "@/types/documents";
import type { SearchMode } from "@/lib/search/display-state";
import { interpolate } from "@/lib/i18n/format";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";

const LOCALE_MAP = {
  en: en.search.semanticResults,
  "zh-CN": zhCN.search.semanticResults,
} as const;

export function getSearchResultBadge(result: SearchResult, mode: SearchMode, locale: string) {
  const sr = LOCALE_MAP[locale as keyof typeof LOCALE_MAP] ?? LOCALE_MAP.en;
  const percent = Math.max(0, Math.min(100, Math.round((result.score || 0) * 100)));

  if (mode === "keyword") {
    return {
      text: interpolate(sr.hit, { n: percent }),
      className: "bg-muted text-muted-foreground",
    };
  }

  const semanticScore = typeof result.debug?.vectorScore === "number" ? result.debug.vectorScore : result.score;
  const semanticPercent = Math.max(0, Math.min(100, Math.round((semanticScore || 0) * 100)));

  if (semanticPercent >= 80) {
    return {
      text: interpolate(sr.match, { n: semanticPercent }),
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    };
  }
  if (semanticPercent >= 60) {
    return {
      text: interpolate(sr.match, { n: semanticPercent }),
      className: "bg-primary-100 text-primary",
    };
  }
  return {
    text: interpolate(sr.match, { n: semanticPercent }),
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
  };
}
