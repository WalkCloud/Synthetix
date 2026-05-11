"use client";

interface UploadItem {
  name: string;
  size: number;
  status: "uploading" | "converting" | "ready" | "failed";
  progress: number;
  error?: string;
  docId?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

const statusLabels: Record<UploadItem["status"], string> = {
  uploading: "Uploading...",
  converting: "Converting...",
  ready: "Complete",
  failed: "Failed",
};

const statusColors: Record<UploadItem["status"], string> = {
  uploading: "text-[#2563EB]",
  converting: "text-[#D97706]",
  ready: "text-[#16A34A]",
  failed: "text-[#DC2626]",
};

export function UploadProgress({ items }: { items: UploadItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-6 space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-4 p-4 bg-white border rounded-[14px]">
          <div className="w-9 h-9 rounded-[12px] bg-primary-100 text-primary flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium truncate">{item.name}</span>
              <span className={`text-xs font-medium ${statusColors[item.status]}`}>
                {statusLabels[item.status]}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-[#F4F2EF] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    item.status === "failed" ? "bg-[#DC2626]" : "bg-primary"
                  }`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{formatSize(item.size)}</span>
            </div>
            {item.error && <p className="text-xs text-[#DC2626] mt-1">{item.error}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export type { UploadItem };
