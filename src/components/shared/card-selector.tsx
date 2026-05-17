import type { ReactNode } from "react";

interface CardSelectorProps {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}

export function CardSelector({ selected, onSelect, icon, title, description }: CardSelectorProps) {
  return (
    <button
      onClick={onSelect}
      className={`relative border-2 rounded-[16px] p-5 text-left transition-colors cursor-pointer ${
        selected
          ? "border-primary bg-primary-50"
          : "border-[#F4F2EF] hover:border-primary-light hover:bg-primary-50"
      }`}
    >
      <div
        className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
          selected ? "bg-primary border-primary" : "border-border"
        }`}
      >
        <svg
          className={`w-3 h-3 text-white ${selected ? "opacity-100" : "opacity-0"} transition-opacity`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="flex items-center gap-3 mb-2.5">
        {icon}
        <div className="text-[15px] font-semibold">{title}</div>
      </div>
      <div className="text-[13px] text-muted-foreground leading-relaxed">{description}</div>
    </button>
  );
}
