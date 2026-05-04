"use client";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl border-b flex items-center justify-between"
      style={{
        background: "rgba(247, 246, 243, 0.85)",
        padding: "0 32px",
        height: 64,
      }}
    >
      <h2 className="text-[22px] font-semibold font-display">{title}</h2>

      <div className="flex items-center gap-3">
        {/* Search bar */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
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
            className="py-2 pr-3.5 pl-9 border rounded-full text-sm bg-base-gray w-60
              focus:outline-none focus:border-primary focus:bg-base-white focus:ring-[3px] focus:ring-primary/12
              focus:w-[300px] transition-all duration-200"
          />
        </div>

        {/* Notification button */}
        <button
          className="relative w-10 h-10 flex items-center justify-center rounded-xl border bg-base-white
            hover:bg-base-gray hover:border-primary/25 transition-all duration-200 cursor-pointer"
        >
          <svg
            className="w-[18px] h-[18px] text-secondary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute top-2 right-2 w-2 h-2 bg-accent rounded-full border-2 border-base-white" />
        </button>
      </div>
    </header>
  );
}
