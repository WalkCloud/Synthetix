"use client";

import { segmentContent } from "@/lib/writing/diagram";
import { DiagramPlaceholder } from "./diagram-placeholder";

export function ContentRenderer({ content }: { content: string }) {
  const segments = segmentContent(content);

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "diagram" ? (
          <DiagramPlaceholder key={`dg-${i}`} diagram={seg.diagram} />
        ) : (
          seg.content.split("\n\n").map((p, j) => (
            <p key={`t-${i}-${j}`} className="mb-3">
              {p}
            </p>
          ))
        )
      )}
    </>
  );
}
