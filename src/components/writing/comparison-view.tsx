"use client";

interface ComparisonViewProps {
  contentA: string | null;
  contentB: string | null;
  modelAName: string;
  modelBName: string;
  onSelectA: () => void;
  onSelectB: () => void;
  onMerge: () => void;
  onEdit: (content: string, source: "a" | "b") => void;
  mode: "compare" | "single";
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function ModelPanel({
  label,
  dotColor,
  content,
  onCopy,
  onEdit,
}: {
  label: string;
  dotColor: "green" | "blue";
  content: string | null;
  onCopy: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-slate-200 bg-slate-50">
        <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              dotColor === "green" ? "bg-emerald-500" : "bg-blue-500"
            }`}
          />
          {label}
        </h4>
        <button
          onClick={onCopy}
          className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          Copy
        </button>
      </div>
      <div className="p-5 text-[15px] leading-loose text-slate-700 min-h-[260px]">
        {content ? (
          content.split("\n\n").map((p, i) => (
            <p key={i} className="mb-3">
              {p}
            </p>
          ))
        ) : (
          <div className="text-slate-400 italic">Waiting for generation...</div>
        )}
      </div>
      <div className="flex items-center justify-between px-[18px] py-3 border-t border-slate-200 text-[13px] text-slate-500 font-medium">
        <span>{content ? `${countWords(content)} words` : "—"}</span>
        <button
          onClick={onEdit}
          className="text-[13px] text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

export function ComparisonView({
  contentA,
  contentB,
  modelAName,
  modelBName,
  onSelectA,
  onSelectB,
  onMerge,
  onEdit,
  mode,
}: ComparisonViewProps) {
  if (mode === "single") {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-slate-200 bg-slate-50">
          <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            {modelAName}
          </h4>
          <button
            onClick={() => contentA && navigator.clipboard.writeText(contentA)}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Copy
          </button>
        </div>
        <div className="p-5 text-[15px] leading-loose text-slate-700 min-h-[260px]">
          {contentA ? (
            contentA.split("\n\n").map((p, i) => <p key={i} className="mb-3">{p}</p>)
          ) : (
            <div className="text-slate-400 italic">Waiting for generation...</div>
          )}
        </div>
        <div className="flex items-center justify-end px-[18px] py-3 border-t border-slate-200 bg-slate-50/50">
          <button
            onClick={() => contentA && onEdit(contentA, "a")}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-5">
        <ModelPanel
          label={modelAName}
          dotColor="green"
          content={contentA}
          onCopy={() => contentA && navigator.clipboard.writeText(contentA)}
          onEdit={() => contentA && onEdit(contentA, "a")}
        />
        <ModelPanel
          label={modelBName}
          dotColor="blue"
          content={contentB}
          onCopy={() => contentB && navigator.clipboard.writeText(contentB)}
          onEdit={() => contentB && onEdit(contentB, "b")}
        />
      </div>

      <div className="flex items-center justify-between mt-5 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="flex gap-2.5">
          <button
            onClick={onSelectA}
            className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-emerald-500 text-emerald-600 bg-transparent rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Select A
          </button>
          <button
            onClick={onSelectB}
            className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-blue-500 text-blue-600 bg-transparent rounded-xl text-sm font-semibold hover:bg-blue-50 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Select B
          </button>
          <button
            onClick={onMerge}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
            Merge Both
          </button>
        </div>
      </div>
    </>
  );
}
