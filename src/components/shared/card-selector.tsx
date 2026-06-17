import type { ReactNode } from "react";

interface CardSelectorProps {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  /** When true the card is non-interactive (e.g. a not-yet-available option). */
  disabled?: boolean;
  /** Optional corner badge (e.g. "待开放"). Shown instead of the selection radio. */
  badge?: string;
}

export function CardSelector({ selected, onSelect, icon, title, description, disabled, badge }: CardSelectorProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={`relative border-2 rounded-[16px] p-5 text-left transition-colors ${
        disabled
          ? "border-border opacity-60 cursor-not-allowed"
          : selected
            ? "border-primary bg-primary-50 dark:bg-primary/10 cursor-pointer"
            : "border-border hover:border-primary-light hover:bg-primary-50 dark:hover:bg-primary/8 cursor-pointer"
      }`}
    >
      {badge ? (
        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40 whitespace-nowrap">
          {badge}
        </span>
      ) : (
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
      )}
      <div className="flex items-center gap-3 mb-2.5">
        {icon}
        <div className="text-[15px] font-semibold">{title}</div>
      </div>
      <div className="text-[13px] text-muted-foreground leading-relaxed">{description}</div>
    </button>
  );
}
