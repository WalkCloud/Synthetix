"use client";

import type { TopologyStats } from "@/types/topology";
import { useLocale } from "@/lib/i18n";
import { formatTopologyStats } from "@/lib/i18n/topology-count";

interface TopologyStatsBarProps {
  readonly stats: TopologyStats;
}

export function TopologyStatsBar({ stats }: TopologyStatsBarProps) {
  const { locale, t } = useLocale();
  const summary = formatTopologyStats(stats, locale, t.topology.counts);

  return (
    <p className="text-[12px] text-muted-foreground mt-3">
      {summary}
      {stats.coverage && <> &middot; {stats.coverage}</>}
    </p>
  );
}
