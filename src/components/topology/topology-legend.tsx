interface LegendItem {
  label: string;
  color: string;
}

const LEGEND_ITEMS: readonly LegendItem[] = [
  { label: "Current Document", color: "#4361EE" },
  { label: "PDF", color: "#2563EB" },
  { label: "DOCX", color: "#EA580C" },
  { label: "Markdown", color: "#16A34A" },
] as const;

export function TopologyLegend() {
  return (
    <div className="flex items-center gap-4">
      {LEGEND_ITEMS.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-xs text-[#A1A1AA]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
