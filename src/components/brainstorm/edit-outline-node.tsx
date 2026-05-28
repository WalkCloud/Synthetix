import {
  Plus, Trash2, X, GripVertical,
} from "lucide-react";
import type { OutlineSection } from "@/lib/outline-tree";

interface EditOutlineNodeProps {
  section: OutlineSection;
  path: number[];
  onUpdate: (path: number[], field: "title" | "estimatedWords", value: string) => void;
  onRemove: (path: number[]) => void;
  onAddChild: (parentPath: number[]) => void;
  depth: number;
}

function EditOutlineNode({ section, path, onUpdate, onRemove, onAddChild, depth }: EditOutlineNodeProps) {
  const isTop = depth === 0;
  const indent = depth > 0 ? `pl-${Math.min(depth * 4, 12)}` : "";

  return (
    <div className={isTop ? "rounded-[12px] border bg-card shadow-sm overflow-hidden" : undefined}>
      <div className={`flex items-center gap-2 ${isTop ? "p-3" : "py-2 pr-1"} ${indent}`}>
        {isTop && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className={`shrink-0 ${isTop ? "w-5 text-sm font-bold" : "min-w-6 text-xs font-semibold"} text-primary`}>
          {section.num}
        </span>
        <input
          type="text"
          value={section.title}
          onChange={(e) => onUpdate(path, "title", e.target.value)}
          placeholder={isTop ? "Section title..." : "Sub-section title..."}
          className={`min-w-0 flex-1 bg-transparent text-foreground focus:outline-none ${isTop ? "text-sm font-semibold" : "text-[13px] border-b border-dashed border-border focus:border-primary-400"}`}
        />
        <input
          type="text"
          inputMode="numeric"
          value={section.estimatedWords || ""}
          onChange={(e) => onUpdate(path, "estimatedWords", e.target.value)}
          className={`shrink-0 rounded ${isTop               ? "w-16 rounded-lg border bg-muted/50 px-2 py-1 text-xs focus:ring-2 focus:ring-primary/20"               : "w-14 border border-border bg-card px-1.5 py-0.5 text-[11px] focus:ring-1 focus:ring-primary/20"} text-center text-muted-foreground focus:outline-none`}
          placeholder="words"
        />
        <button
          onClick={() => onRemove(path)}
          className={`flex shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-red-500 ${isTop ? "h-7 w-7 rounded-lg hover:bg-red-50 hover:text-red-600" : "h-6 w-6"}`}
        >
          {isTop ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
      {isTop && section.children && section.children.length > 0 && (
        <div className="border-t bg-muted/40 p-2 space-y-2">
          {section.children.map((child, ci) => (
            <EditOutlineNode key={ci} section={child} path={[...path, ci]} onUpdate={onUpdate} onRemove={onRemove} onAddChild={onAddChild} depth={depth + 1} />
          ))}
        </div>
      )}
      {!isTop && section.children && section.children.length > 0 && (
        <div className="space-y-1">
          {section.children.map((child, ci) => (
            <EditOutlineNode key={ci} section={child} path={[...path, ci]} onUpdate={onUpdate} onRemove={onRemove} onAddChild={onAddChild} depth={depth + 1} />
          ))}
        </div>
      )}
      {(isTop || (section.children && section.children.length > 0)) && (
        <div className={`${isTop ? "pl-6 pt-1 pb-1" : "pl-4 pt-0.5 pb-0.5"}`}>
          <button onClick={() => onAddChild(path)} className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-primary/60 hover:text-primary transition-colors">
            <Plus className="h-3 w-3" /> Add Sub-section
          </button>
        </div>
      )}
      {!isTop && !section.children?.length && (
        <div className="pl-4 pt-0.5 pb-0.5">
          <button onClick={() => onAddChild(path)} className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-primary/50 hover:text-primary transition-colors">
            <Plus className="h-2.5 w-2.5" /> Add Sub-section
          </button>
        </div>
      )}
    </div>
  );
}

export { EditOutlineNode };
