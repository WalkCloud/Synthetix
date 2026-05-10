import type { TopologyStats } from "@/types/topology";

interface TopologyStatsBarProps {
  readonly stats: TopologyStats;
}

interface StatEntry {
  label: string;
  value: string;
}

function buildStatEntries(stats: TopologyStats): readonly StatEntry[] {
  if (stats.totalEntities !== undefined) {
    return [
      { label: "Entities", value: String(stats.totalEntities) },
      { label: "Relations", value: String(stats.totalRelations ?? 0) },
    ] as const;
  }
  return [
    { label: "Total References", value: String(stats.totalReferences) },
    { label: "Unique Documents", value: String(stats.uniqueDocuments) },
    { label: "Most Referenced", value: stats.mostReferencedDoc ?? "N/A" },
    { label: "Coverage", value: stats.coverage },
  ] as const;
}

export function TopologyStatsBar({ stats }: TopologyStatsBarProps) {
  const entries = buildStatEntries(stats);

  return (
    <div className="flex items-center gap-5">
      {entries.map((entry) => (
        <div key={entry.label} className="flex items-center gap-1.5">
          <span className="text-[13px] text-[#52525B]">{entry.label}:</span>
          <span className="text-[13px] font-bold text-[#18181B]">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
