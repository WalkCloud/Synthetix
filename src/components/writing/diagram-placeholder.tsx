"use client";

import { useState } from "react";
import Image from "next/image";
import { diagramTypeLabel } from "@/lib/writing/diagram";
import type { DiagramRequest } from "@/lib/writing/diagram";

export function DiagramPlaceholder({ diagram }: { diagram: DiagramRequest }) {
  return (
    <div className="my-4 border border-dashed border-border rounded-xl bg-muted/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-amber-600">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 3v18" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
              {diagramTypeLabel(diagram.type)}
            </span>
            <span className="text-[11px] text-muted-foreground">Diagram Request</span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">
            {diagram.title}
          </p>
          {diagram.purpose && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {diagram.purpose}
            </p>
          )}
          {diagram.nodes && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Nodes: {diagram.nodes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DiagramView({
  serveUrl,
  title,
  markerId,
  kind,
  onMarkerClick,
}: {
  serveUrl: string;
  title?: string;
  markerId?: string;
  kind?: "image" | "diagram";
  onMarkerClick?: (markerId: string, kind: "image" | "diagram") => void;
}) {
  const [error, setError] = useState(false);
  const [hovering, setHovering] = useState(false);

  if (error) {
    return (
      <figure className="my-4 border border-dashed border-red-200 rounded-xl bg-red-50/50 p-4">
        <div className="text-sm text-red-600 flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
          Diagram failed to load
        </div>
      </figure>
    );
  }

  const interactive = markerId && onMarkerClick;

  return (
    <figure className="my-5">
      <div
        className="relative group"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <Image
          src={serveUrl}
          alt={title || "Architecture diagram"}
          width={1200}
          height={675}
          className="h-auto w-full rounded-xl border border-border bg-card"
          unoptimized
          onError={() => setError(true)}
        />
        {interactive && hovering && (
          <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center transition-opacity">
            <button
              type="button"
              onClick={() => onMarkerClick!(markerId!, kind || "image")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-gray-900 text-sm font-medium shadow-lg hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              Regenerate
            </button>
          </div>
        )}
      </div>
      {title && (
        <figcaption className="text-center text-xs text-muted-foreground mt-2">
          {title}
        </figcaption>
      )}
    </figure>
  );
}
