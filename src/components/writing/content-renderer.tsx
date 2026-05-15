"use client";

import { segmentContent } from "@/lib/writing/diagram";
import { DiagramPlaceholder, DiagramView } from "./diagram-placeholder";

const DIAGRAM_MARKER_RE = /\[DIAGRAM:([a-f0-9-]+)\]/g;

export function ContentRenderer({
  content,
  draftId,
  sectionId,
}: {
  content: string;
  draftId: string;
  sectionId: string;
}) {
  const segments = segmentContent(content);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "diagram") {
          return <DiagramPlaceholder key={`dg-${i}`} diagram={seg.diagram} />;
        }

        const parts: Array<{ type: "text" | "diagram"; content: string; assetId?: string }> = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        DIAGRAM_MARKER_RE.lastIndex = 0;
        while ((match = DIAGRAM_MARKER_RE.exec(seg.content)) !== null) {
          if (match.index > lastIndex) {
            parts.push({ type: "text", content: seg.content.slice(lastIndex, match.index) });
          }
          parts.push({ type: "diagram", content: match[0], assetId: match[1] });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < seg.content.length) {
          parts.push({ type: "text", content: seg.content.slice(lastIndex) });
        }

        if (parts.length === 0) {
          return seg.content
            .split("\n\n")
            .map((p, j) => (
              <p key={`t-${i}-${j}`} className="mb-3">
                {p}
              </p>
            ));
        }

        return (
          <span key={`seg-${i}`}>
            {parts.map((part, j) =>
              part.type === "diagram" && part.assetId ? (
                <DiagramView
                  key={`dv-${i}-${j}`}
                  serveUrl={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${part.assetId}/serve`}
                />
              ) : (
                part.content
                  .split("\n\n")
                  .map((p, k) => (
                    <p key={`t-${i}-${j}-${k}`} className="mb-3">
                      {p}
                    </p>
                  ))
              )
            )}
          </span>
        );
      })}
    </>
  );
}
