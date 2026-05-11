"use client";

interface Reference {
  documentName: string;
  content: string;
  score: number;
  title?: string | null;
  sourceInfo?: string;
}

interface ReferencePanelProps {
  references: Reference[];
  sectionNotes: string;
  onSectionNotesChange: (notes: string) => void;
}

export function ReferencePanel({
  references,
  sectionNotes,
  onSectionNotesChange,
}: ReferencePanelProps) {
  return (
    <div className="bg-white border-l border-slate-200 p-5 overflow-y-auto h-full">
      {/* References */}
      <div className="mb-5">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          References
          <span className="text-[11px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full font-bold">
            {references.length}
          </span>
        </h4>

        {references.length === 0 ? (
          <div className="text-xs text-slate-400 py-4 text-center">
            References will appear after generation
          </div>
        ) : (
          references.map((ref, i) => (
            <div
              key={i}
              className="p-3 border border-slate-200 rounded-xl mb-2.5 cursor-pointer hover:border-primary-500 transition-colors bg-slate-50"
            >
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-slate-900">{ref.documentName}</span>
                <span className="text-xs text-primary-600 font-bold">{Math.round(ref.score * 100)}%</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mt-1.5 line-clamp-3">
                {ref.content.slice(0, 200)}
              </p>
              {ref.sourceInfo && (
                <div className="text-[11px] text-slate-400 mt-1.5">{ref.sourceInfo}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Images */}
      {/* Images */}
      <div className="mb-5">
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          Images
        </h4>
        <p className="text-xs text-slate-400 mb-2.5">Image generation coming in P6</p>
        <div className="w-full h-20 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-xs mb-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            Gen
          </button>
          <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Mermaid
          </button>
          <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <rect x="7" y="7" width="10" height="10" />
            </svg>
            DrawIO
          </button>
        </div>
      </div>

      {/* Section Notes */}
      <div>
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-slate-900">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-primary-600">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Section Notes
        </h4>
        <textarea
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none shadow-sm"
          placeholder="Add notes for this section..."
          style={{ minHeight: "100px" }}
          value={sectionNotes}
          onChange={(e) => onSectionNotesChange(e.target.value)}
        />
      </div>
    </div>
  );
}
