"use client";

import { ContentRenderer } from "./content-renderer";

interface ComparisonViewProps {
  contentA: string | null;
  contentB: string | null;
  modelAName: string;
  modelBName: string;
  modelA: string | null;
  modelB: string | null;
  selectedModel: string | null;
  onSelectA: () => void;
  onSelectB: () => void;
  onEdit: (content: string, source: "a" | "b") => void;
  mode: "compare" | "single";
}

function countWords(text: string): number {
  const latin = text.match(/[a-zA-Z0-9]+/g) || [];
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g) || [];
  return latin.length + cjk.length;
}

function ModelPanel({
  label,
  dotColor,
  content,
  isSelected,
  onSelect,
  onCopy,
  onEdit,
}: {
  label: string;
  dotColor: "green" | "blue";
  content: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  return (
    <div className={`bg-white rounded-2xl overflow-hidden shadow-sm transition-colors ${
      isSelected
        ? dotColor === "green"
          ? "border-2 border-emerald-500 ring-2 ring-emerald-100"
          : "border-2 border-blue-500 ring-2 ring-blue-100"
        : "border border-slate-200"
    }`}>
      <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-slate-200 bg-slate-50">
        <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              dotColor === "green" ? "bg-emerald-500" : "bg-blue-500"
            }`}
          />
          {label}
        </h4>
        <div className="flex items-center gap-1">
          <button
            onClick={onCopy}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Copy
          </button>
          <button
            onClick={onEdit}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Edit
          </button>
        </div>
      </div>
      <div className="p-5 text-[15px] leading-loose text-slate-700 min-h-[260px]">
        {content ? (
          <ContentRenderer content={content} />
        ) : (
          <div className="text-slate-400 italic">Waiting for generation...</div>
        )}
      </div>
      <div className="flex items-center justify-between px-[18px] py-3 border-t border-slate-200 bg-slate-50/50 text-[13px] text-slate-500 font-medium">
        <span>{content ? `${countWords(content)} words` : "—"}</span>
        <button
          onClick={onSelect}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            isSelected
              ? dotColor === "green"
                ? "bg-emerald-500 text-white shadow-sm"
                : "bg-blue-500 text-white shadow-sm"
              : dotColor === "green"
                ? "text-emerald-600 hover:bg-emerald-50"
                : "text-blue-600 hover:bg-blue-50"
          }`}
        >
          {isSelected && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {isSelected ? "Selected" : "Select"}
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
  modelA,
  modelB,
  selectedModel,
  onSelectA,
  onSelectB,
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => contentA && navigator.clipboard.writeText(contentA)}
              className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Copy
            </button>
            <button
              onClick={() => contentA && onEdit(contentA, "a")}
              className="text-[13px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Edit
            </button>
          </div>
        </div>
        <div className="p-5 text-[15px] leading-loose text-slate-700 min-h-[260px]">
          {contentA ? (
            <ContentRenderer content={contentA} />
          ) : (
            <div className="text-slate-400 italic">Waiting for generation...</div>
          )}
        </div>
        <div className="flex items-center justify-between px-[18px] py-3 border-t border-slate-200 bg-slate-50/50 text-[13px] text-slate-500 font-medium">
          <span>{contentA ? `${countWords(contentA)} words` : "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <ModelPanel
        label={modelAName}
        dotColor="green"
        content={contentA}
        isSelected={selectedModel === modelA}
        onSelect={onSelectA}
        onCopy={() => contentA && navigator.clipboard.writeText(contentA)}
        onEdit={() => contentA && onEdit(contentA, "a")}
      />
      <ModelPanel
        label={modelBName}
        dotColor="blue"
        content={contentB}
        isSelected={selectedModel === modelB}
        onSelect={onSelectB}
        onCopy={() => contentB && navigator.clipboard.writeText(contentB)}
        onEdit={() => contentB && onEdit(contentB, "b")}
      />
    </div>
  );
}
