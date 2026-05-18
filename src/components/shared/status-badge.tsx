"use client";

interface StatusBadgeProps {
  label: string;
  variant?: "success" | "warning" | "danger" | "info" | "neutral" | "primary";
  size?: "sm" | "md";
  dot?: boolean;
  pulse?: boolean;
}

const variantClasses: Record<NonNullable<StatusBadgeProps["variant"]>, string> = {
  success: "bg-[#DCFCE7] text-[#16A34A]",
  warning: "bg-[#FEF3C7] text-[#D97706]",
  danger: "bg-[#FEE2E2] text-[#DC2626]",
  info: "bg-[#FFF7ED] text-[#EA580C]",
  neutral: "bg-[#F4F2EF] text-[#6B6560]",
  primary: "bg-primary-100 text-primary",
};

const dotClasses: Record<NonNullable<StatusBadgeProps["variant"]>, string> = {
  success: "bg-[#16A34A]",
  warning: "bg-[#D97706]",
  danger: "bg-[#DC2626]",
  info: "bg-[#EA580C]",
  neutral: "bg-[#6B6560]",
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
