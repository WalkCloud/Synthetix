export function TopologyLegend() {
  const items = [
    { label: "Current Document", color: "#3A2E85", shape: "square" as const },
    { label: "PDF", color: "#2563EB", shape: "circle" as const },
    { label: "DOCX", color: "#EA580C", shape: "circle" as const },
    { label: "Markdown", color: "#16A34A", shape: "circle" as const },
    { label: "Entity", color: "#7C3AED", shape: "circle" as const },
  ] as const;

  return (
    <div className="flex items-center gap-4 mt-3 mb-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block shrink-0"
            style={{
              width: item.shape === "square" ? 8 : 8,
              height: 8,
              borderRadius: item.shape === "square" ? 2 : "50%",
              backgroundColor: item.color,
            }}
          />
          <span className="text-[11px] text-[#8C887F]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
