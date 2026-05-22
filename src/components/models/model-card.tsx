interface IconColors {
  bg: string;
  text: string;
}

export function parseContextWindow(n: number | null): string {
  if (n === null || n === 0) return "-";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function ModelCard({
  name,
  providerName,
  contextWindow,
  isActive,
  isTesting,
  testResult,
  isDeleting,
  iconColors,
  isDefault,
  onTest,
  onEdit,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
  onToggleDefault,
}: {
  name: string;
  providerName: string;
  contextWindow: number;
  isActive: boolean;
  isTesting: boolean;
  testResult: { connected: boolean; contextWindows?: Record<string, number>; error?: string } | null;
  isDeleting: boolean;
  iconColors: IconColors;
  isDefault: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onToggleDefault: () => void;
}) {
  return (
    <div
      className={`bg-white border rounded-2xl px-6 py-5 shadow-soft hover:shadow-hover transition-all relative overflow-hidden ${isTesting ? "border-primary-300" : "border-border"}`}
      style={{ animation: "fadeInUp 0.4s ease both" }}
    >
      {isTesting && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-slate-100 overflow-hidden">
          <div className="h-full bg-primary-600 animate-loading-bar" style={{ width: "40%" }} />
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconColors.bg} ${iconColors.text}`}>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-foreground">{name}</span>
              {isDefault && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M8 1l2.2 4.5L15 6.1l-3.5 3.4.8 4.9L8 12.1 3.7 14.4l.8-4.9L1 6.1l4.8-.6z" />
                  </svg>
                  Default
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {providerName}{contextWindow > 0 && (<><span className="text-slate-300 mx-1.5">|</span>{parseContextWindow(contextWindow)} tokens</>)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {testResult ? (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${testResult.connected ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
              {testResult.connected ? "Connected" : "Failed"}
            </span>
          ) : isActive ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Disconnected
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-4">
        <span className="text-xs font-medium px-2 py-1 bg-slate-50 text-slate-500 rounded-md border border-slate-100">{providerName}</span>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <>
              <button onClick={onDeleteConfirm}
                className="px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm">
                Confirm
              </button>
              <button onClick={onDeleteCancel}
                className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={onToggleDefault} title={isDefault ? "Remove default" : "Set as default model"}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isDefault ? "text-amber-500 hover:bg-amber-50" : "text-slate-300 hover:text-amber-400 hover:bg-slate-50"}`}>
                <svg viewBox="0 0 24 24" fill={isDefault ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path d="M8 1l2.2 4.5L15 6.1l-3.5 3.4.8 4.9L8 12.1 3.7 14.4l.8-4.9L1 6.1l4.8-.6z" transform="translate(4,3) scale(0.85)" />
                </svg>
              </button>
              <button onClick={onTest} disabled={isTesting}
                className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:text-primary-600 hover:border-primary-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
                {isTesting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Testing...
                  </>
                ) : "Test Connection"}
              </button>
              <button onClick={onEdit}
                className="px-4 py-1.5 text-sm font-medium text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                Edit
              </button>
              <button onClick={onDelete}
                className="px-4 py-1.5 text-sm font-medium text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
