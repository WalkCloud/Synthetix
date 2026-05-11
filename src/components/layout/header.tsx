"use client";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md border-b border-border flex items-center justify-between px-8 h-14"
      style={{
        background: "rgba(248, 250, 252, 0.88)",
      }}
    >
      <h2 className="text-lg font-bold font-display tracking-tight text-slate-800">{title}</h2>

      <div className="flex items-center gap-3">
        {/* Search bar */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-muted-foreground pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search documents..."
            className="py-1.5 pr-3 pl-8 border border-border rounded-xl text-xs bg-white w-[220px]
              focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10
              focus:w-[260px] transition-all duration-200 shadow-sm"
          />
        </div>

        {/* Notification button */}
        <button
          className="relative w-[34px] h-[34px] flex items-center justify-center rounded-xl border border-border bg-white
            hover:bg-secondary transition-all duration-200 cursor-pointer"
        >
          <svg
            className="w-4 h-4 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute top-[6px] right-[6px] w-[7px] h-[7px] bg-orange-500 rounded-full border-2 border-white" />
        </button>
      </div>
    </header>
  );
}
