import { useLocale } from "@/lib/i18n";

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

interface TestResult {
  connected: boolean;
  contextWindows?: Record<string, number>;
  embeddingDims?: Record<string, number>;
  embedDimErrors?: string[];
  error?: string;
}

export function ModelCard({
  name,
  modelId,
  providerName,
  contextWindow,
  embeddingDim,
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
  modelId?: string;
  providerName: string;
  contextWindow: number;
  embeddingDim?: number | null;
  isActive: boolean;
  isTesting: boolean;
  testResult: TestResult | null;
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
  const { t } = useLocale();

  // Check if THIS model had its embedding dim detected or errored
  const detectedEmbedDim = modelId ? testResult?.embeddingDims?.[modelId] : undefined;
  const embedDimError = modelId
    ? testResult?.embedDimErrors?.find((e: string) => e.startsWith(modelId))
    : undefined;

  return (
    <div
      className={`bg-card border rounded-2xl px-6 py-5 shadow-soft hover:shadow-hover transition-all relative overflow-hidden ${isTesting ? "border-primary-300 dark:border-primary-600" : "border-border"}`}
      style={{ animation: "fadeInUp 0.4s ease both" }}
    >
      {isTesting && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-secondary overflow-hidden">
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
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/35 dark:text-amber-300 dark:border-amber-800/40">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M8 1l2.2 4.5L15 6.1l-3.5 3.4.8 4.9L8 12.1 3.7 14.4l.8-4.9L1 6.1l4.8-.6z" />
                  </svg>
                  {t.models.models.isDefault}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {providerName}
              {contextWindow > 0 && (<><span className="text-border mx-1.5">|</span>{parseContextWindow(contextWindow)} {t.models.models.tokens}</>)}
              {(embeddingDim ?? 0) > 0 && (<><span className="text-border mx-1.5">|</span>dim: {embeddingDim}</>)}
            </div>
            {/* Embedding dimension detection status */}
            {detectedEmbedDim !== undefined && (
              <div className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded mt-1 inline-block">
                {t.models.models.embeddingDimDetected}: {detectedEmbedDim}
              </div>
            )}
            {embedDimError && (
              <div className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded mt-1 inline-block">
                {embedDimError}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {testResult ? (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${testResult.connected ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/35 dark:text-green-400 dark:border-green-800/40" : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/35 dark:text-red-400 dark:border-red-800/40"}`}>
              {testResult.connected ? t.models.models.connected : t.models.models.failed}
            </span>
          ) : isActive ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/35 border border-green-100 dark:border-green-800/40 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {t.models.models.connected}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              {t.models.models.disconnected}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
        <span className="text-xs font-medium px-2 py-1 bg-muted/50 text-muted-foreground rounded-md border border-border">{providerName}</span>
        <div className="flex items-center gap-2">
          {isDeleting ? (
            <>
              <button onClick={onDeleteConfirm}
                className="px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm">
                {t.common.actions.confirm}
              </button>
              <button onClick={onDeleteCancel}
                className="px-4 py-1.5 text-sm font-medium border border-border text-muted-foreground rounded-lg hover:bg-secondary/70 transition-colors">
                {t.common.actions.cancel}
              </button>
            </>
          ) : (
            <>
              <button onClick={onToggleDefault} title={isDefault ? t.models.models.removeDefault : t.models.models.setDefault}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${isDefault ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30" : "text-muted-foreground/30 hover:text-amber-400 dark:hover:text-amber-300 hover:bg-secondary/70"}`}>
                <svg viewBox="0 0 24 24" fill={isDefault ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path d="M8 1l2.2 4.5L15 6.1l-3.5 3.4.8 4.9L8 12.1 3.7 14.4l.8-4.9L1 6.1l4.8-.6z" transform="translate(4,3) scale(0.85)" />
                </svg>
              </button>
              <button onClick={onTest} disabled={isTesting}
                className="px-4 py-1.5 text-sm font-medium border border-border text-foreground/75 rounded-lg hover:bg-secondary/70 hover:text-primary-600 hover:border-primary-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
                {isTesting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    {t.models.models.testing}
                  </>
                ) : t.models.providers.testConnection}
              </button>
              <button onClick={onEdit}
                className="px-4 py-1.5 text-sm font-medium text-muted-foreground rounded-lg hover:bg-secondary transition-colors">
                {t.common.actions.edit}
              </button>
              <button onClick={onDelete}
                className="px-4 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                {t.common.actions.delete}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
