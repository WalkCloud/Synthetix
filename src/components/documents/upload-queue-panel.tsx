"use client";

import { formatFileSize } from "@/lib/text/format-file-size";
import { getFileExt, getFileIconClass } from "@/lib/text/file-utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { useLocale } from "@/lib/i18n";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: "queued" | "converting" | "complete" | "failed";
  progress: number;
  docId?: string;
  error?: string;
}

interface UploadQueueProps {
  items: UploadItem[];
  onRemove: (id: string) => void;
}

export function UploadQueue({ items, onRemove }: UploadQueueProps) {
  const { t } = useLocale();
  if (items.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-[16px] shadow-sm mb-6 animate-fade-in-up">
      <div className="flex items-center justify-between px-6 py-5 border-b border-border">
        <h3 className="font-display text-[16px] font-semibold text-foreground">{t.documents.upload.queuing}</h3>
        <StatusBadge label={`${items.length}`} variant="primary" size="md" />
      </div>
      <div className="px-6 py-2">
        {items.map((item) => {
          const ext = getFileExt(item.name);
          const ic = getFileIconClass(ext);
          return (
            <div key={item.id} className="flex items-center gap-4 py-4 border-b border-border last:border-b-0">
              <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${ic}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-foreground mb-1">{item.name}</div>
                <div className="text-[12px] text-muted-foreground">{formatFileSize(item.size)}</div>
                {item.status === "converting" && (
                  <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-[140px] shrink-0">
                {item.status === "converting" && (
                  <>
                    <StatusBadge label={t.documents.uploadQueue.converting} variant="info" size="md" />
                    <span className="text-[13px] font-semibold text-primary">{item.progress}%</span>
                  </>
                )}
                {item.status === "complete" && (
                  <StatusBadge label={t.documents.uploadQueue.complete} variant="success" size="md" />
                )}
                {item.status === "queued" && (
                  <StatusBadge label={t.documents.uploadQueue.queued} variant="neutral" size="md" />
                )}
                {item.status === "failed" && (
                  <StatusBadge label={item.error || t.documents.uploadQueue.failed} variant="danger" size="md" />
                )}
              </div>
              <button onClick={() => onRemove(item.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
