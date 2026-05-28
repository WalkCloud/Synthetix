"use client";

interface StatusBadgeProps {
  label: string;
  variant?: "success" | "warning" | "danger" | "info" | "neutral" | "primary";
  size?: "sm" | "md";
  dot?: boolean;
  pulse?: boolean;
}

const variantClasses: Record<NonNullable<StatusBadgeProps["variant"]>, string> = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-950/35 dark:text-red-300",
  info: "bg-orange-100 text-orange-700 dark:bg-orange-950/35 dark:text-orange-300",
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-100 text-primary",
};

const dotClasses: Record<NonNullable<StatusBadgeProps["variant"]>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-orange-500",
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
};

export function StatusBadge({ label, variant = "neutral", size = "sm", dot, pulse }: StatusBadgeProps) {
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${sizeClass} ${variantClasses[variant]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[variant]} ${pulse ? "animate-pulse" : ""}`} />}
      {label}
    </span>
  );
}
