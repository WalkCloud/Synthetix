import type { OutlineSection } from "@/lib/outline-tree";

interface DisplayOutlineNodeProps {
  section: OutlineSection;
  path: number[];
  depth: number;
}

function DisplayOutlineNode({ section, path, depth }: DisplayOutlineNodeProps) {
  const isTop = depth === 0;

  if (isTop) {
    return (
      <li className="rounded-[12px] border bg-card shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="min-w-5 shrink-0 text-sm font-bold text-primary">{section.num}.</span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">{section.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">~{section.estimatedWords || 500}w</span>
        </div>
        {section.children && section.children.length > 0 && (
          <ul className="border-t bg-muted/40 px-3 py-2">
            {section.children.map((child, ci) => (
              <DisplayOutlineNode key={ci} section={child} path={[...path, ci]} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-lg">
      <div className="flex items-start gap-2 py-1.5 pr-1" style={{ paddingLeft: `${Math.min(depth * 14, 42)}px` }}>
        <span className={`w-10 shrink-0 text-xs font-semibold tabular-nums ${depth === 1 ? "text-primary/70" : "text-primary/50"}`}>{section.num}</span>
        <span className="min-w-0 flex-1 break-words text-[13px] leading-5 text-foreground">{section.title}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">~{section.estimatedWords || 300}w</span>
      </div>
      {section.children && section.children.length > 0 && (
        <ul className="space-y-0.5">
          {section.children.map((child, ci) => (
            <DisplayOutlineNode key={ci} section={child} path={[...path, ci]} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export { DisplayOutlineNode };
