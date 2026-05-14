import type { TopologyStats } from "@/types/topology";

interface TopologyStatsBarProps {
  readonly stats: TopologyStats;
}

export function TopologyStatsBar({ stats }: TopologyStatsBarProps) {
  if (stats.totalEntities !== undefined) {
    return (
      <p className="text-[12px] text-[#8C887F] mt-3">
        {stats.totalEntities} entities &middot; {stats.totalRelations ?? 0} relations
      </p>
    );
  }

  return (
    <p className="text-[12px] text-[#8C887F] mt-3">
      {stats.totalReferences} references from {stats.uniqueDocuments} documents
      {stats.mostReferencedDoc && (
        <> &middot; most referenced: <span className="text-[#1E1B18] font-medium">{stats.mostReferencedDoc}</span></>
      )}
      {stats.coverage && (
        <> &middot; {stats.coverage}</>
      )}
    </p>
  );
}
