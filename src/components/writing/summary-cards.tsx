"use client";

interface SummaryCard {
  title: string;
  color: "cyan" | "emerald" | "violet" | "amber" | "rose";
  items: string[];
}

const COLOR_MAP = {
  cyan: { dot: "bg-cyan-400", text: "text-cyan-700" },
  emerald: { dot: "bg-emerald-400", text: "text-emerald-700" },
  violet: { dot: "bg-violet-400", text: "text-violet-700" },
  amber: { dot: "bg-amber-400", text: "text-amber-700" },
  rose: { dot: "bg-rose-400", text: "text-rose-700" },
};

export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
      {cards.map((card, i) => {
        const colors = COLOR_MAP[card.color] || COLOR_MAP.cyan;
        return (
          <div key={i} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
              <span className={`text-sm font-semibold ${colors.text}`}>{card.title}</span>
            </div>
            <ul className="space-y-1">
              {card.items.map((item, j) => (
                <li key={j} className="text-xs text-muted-foreground pl-1">• {item}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
