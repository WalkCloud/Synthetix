"use client";

import type { CSSProperties } from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
}

const sizeMap = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-9 h-9" };

export function Spinner({ size = "md", className = "", style }: SpinnerProps) {
  return (
    <svg className={`animate-spin ${sizeMap[size]} ${className}`} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
