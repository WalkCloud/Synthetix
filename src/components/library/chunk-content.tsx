import { useMemo } from "react";
import Image from "next/image";

interface ChunkContentProps {
  content: string;
  docId: string;
}

export function ChunkContent({ content, docId }: ChunkContentProps) {
  const segments = useMemo(() => {
    const segs: Array<{ type: "text" | "image"; content: string; src?: string; alt?: string }> = [];
    let remaining = content;
    while (remaining.length > 0) {
      const imgMatch = remaining.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (!imgMatch || imgMatch.index === undefined) {
        if (remaining.trim()) {
          segs.push({ type: "text", content: remaining });
        }
        break;
      }

      // Text before the image
      if (imgMatch.index > 0) {
        const textBefore = remaining.slice(0, imgMatch.index);
        if (textBefore.trim()) {
          segs.push({ type: "text", content: textBefore });
        }
      }

      // The image
      const alt = imgMatch[1] || "";
      const rawSrc = imgMatch[2] || "";
      const filename = rawSrc.split("/").pop() || rawSrc;
      segs.push({
        type: "image",
        content: `![${alt}](${rawSrc})`,
        src: `/api/v1/documents/${docId}/images/${filename}`,
        alt: alt || filename,
      });

      remaining = remaining.slice(imgMatch.index + imgMatch[0].length);
    }

    return segs;
  }, [content, docId]);

  return (
    <div className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap font-sans max-h-[500px] overflow-y-auto">
      {segments.map((seg, i) =>
        seg.type === "image" && seg.src ? (
          <div key={i} className="my-3">
            <Image
              src={seg.src}
              alt={seg.alt || ""}
              width={800}
              height={450}
              className="h-auto max-w-full rounded-lg border border-slate-200"
              loading="lazy"
              unoptimized
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {seg.alt && seg.alt !== seg.src && (
              <p className="text-[11px] text-muted-foreground mt-1 text-center">{seg.alt}</p>
            )}
          </div>
        ) : (
          <span key={i}>{seg.content}</span>
        )
      )}
    </div>
  );
}
