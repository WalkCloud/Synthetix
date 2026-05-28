"use client";

import { useState } from "react";
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

export function DiagramView({ serveUrl, title }: { serveUrl: string; title?: string }) {
  const [error, setError] = useState(false);

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

  return (
    <figure className="my-5">
      <img
        src={serveUrl}
        alt={title || "Architecture diagram"}
        className="w-full rounded-xl border border-border bg-card"
        onError={() => setError(true)}
      />
      {title && (
        <figcaption className="text-center text-xs text-muted-foreground mt-2">
          {title}
        </figcaption>
      )}
    </figure>
  );
}
