"use client";

import { segmentContent } from "@/lib/writing/diagram";
import { stripLeadingSectionTitle } from "@/lib/writing/strip-section-title";
import { DiagramView } from "./diagram-placeholder";
import { MarkdownBlock } from "./markdown-renderer";
import { MarkerChip } from "./marker-chip";
import { SummaryCards } from "./summary-cards";

export function ContentRenderer({
  content,
  draftId,
  sectionId,
  sectionTitle,
  onMarkerClick,
  summaryCardsMap,
}: {
  content: string;
  draftId: string;
  sectionId: string;
  sectionTitle?: string | null;
  onMarkerClick?: (markerId: string, kind: "image" | "diagram") => void;
  summaryCardsMap?: Record<string, Array<{ title: string; color: "cyan" | "emerald" | "violet" | "amber" | "rose"; items: string[] }>>;
}) {
  const displayContent = stripLeadingSectionTitle(content, sectionTitle);
  const segments = segmentContent(displayContent);

  return (
    <div className="doc-content">
      {segments.map((seg, i) => {
        if (seg.kind === "diagram_asset") {
          const cards = summaryCardsMap?.[seg.assetId];
          return (
            <div key={`da-${i}`}>
              <DiagramView
                serveUrl={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${seg.assetId}/serve`}
              />
              {cards && cards.length > 0 && <SummaryCards cards={cards} />}
            </div>
          );
        }

        if (seg.kind === "image_asset") {
          return (
            <DiagramView
              key={`ia-${i}`}
              serveUrl={`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/${seg.assetId}/serve`}
            />
          );
        }

        if (seg.kind === "diagram_request") {
          return <MarkerChip key={`dr-${i}`} kind="diagram" title={seg.marker.title} markerId={seg.marker.markerId || ""} onClick={onMarkerClick} />;
        }

        if (seg.kind === "image_request") {
          return <MarkerChip key={`ir-${i}`} kind="image" title={seg.marker.title} markerId={seg.marker.markerId || ""} onClick={onMarkerClick} />;
        }

        return <MarkdownBlock key={`mb-${i}`} text={seg.content} />;
      })}
    </div>
  );
}
