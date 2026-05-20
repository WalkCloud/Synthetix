"use client";

import { segmentContent } from "@/lib/writing/diagram";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { DiagramPlaceholder, DiagramView } from "./diagram-placeholder";
import { MarkdownBlock } from "./markdown-renderer";

export function ContentRenderer({
  content,
  draftId,
  sectionId,
  sectionTitle,
  renderVer,
}: {
  content: string;
  draftId: string;
  sectionId: string;
  sectionTitle?: string | null;
  renderVer?: number;
}) {
  const displayContent = stripLeadingSectionTitle(content, sectionTitle);
  const segments = segmentContent(displayContent);
  const v = renderVer ?? 1;

  return (
    <div className="doc-content">
      {segments.map((seg, i) => {
        if (seg.kind === "diagram") {
          return <DiagramPlaceholder key={`dg-${i}`} diagram={seg.diagram} />;
        }

        if (seg.kind === "image") {
          return (
            <div key={`img-req-${i}`} className="my-3 p-3 border border-dashed border-blue-300 rounded-lg bg-blue-50/50 text-center">
              <p className="text-sm text-blue-600 font-medium">📷 {seg.image.title}</p>
              <p className="text-xs text-muted-foreground mt-1">图片待生成</p>
            </div>
          );
        }

        const parts: Array<{ type: "text" | "diagram" | "image"; content: string; assetId?: string }> = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        const ALL_MARKER_RE = /\[(DIAGRAM|IMAGE):([a-f0-9-]+)\]/g;
        ALL_MARKER_RE.lastIndex = 0;
        while ((match = ALL_MARKER_RE.exec(seg.content)) !== null) {
          if (match.index > lastIndex) {
            parts.push({ type: "text", content: seg.content.slice(lastIndex, match.index) });
          }
          parts.push({ type: match[1].toLowerCase() as "diagram" | "image", content: match[0], assetId: match[2] });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < seg.content.length) {
          parts.push({ type: "text", content: seg.content.slice(lastIndex) });
        }

        if (parts.length === 0) {
          return <MarkdownBlock key={`mb-${i}`} text={seg.content} />;
        }

        return (
          <span key={`seg-${i}`}>
            {parts.map((part, j) =>
              part.type === "diagram" && part.assetId ? (
                <DiagramView
                  key={`dv-${i}-${j}`}
                  serveUrl={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${part.assetId}/serve?v=${v}`}
                />
              ) : part.type === "image" && part.assetId ? (
                <DiagramView
                  key={`iv-${i}-${j}`}
                  serveUrl={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${part.assetId}/serve?v=${v}`}
                />
              ) : (
                <MarkdownBlock key={`mb-${i}-${j}`} text={part.content} />
              )
            )}
          </span>
        );
      })}
    </div>
  );
}
