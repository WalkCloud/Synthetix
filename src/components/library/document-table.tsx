"use client";

import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatFileSize } from "@/lib/text/format-file-size";
import { getFileIconClass } from "@/lib/text/file-utils";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import type { DocumentMeta } from "@/types/documents";

interface DocumentTableProps {
  documents: DocumentMeta[];
  loading: boolean;
  filterFormat: string;
  setFilterFormat: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  maxChunks: number;
  tagColors: Record<string, string>;
  onDelete: (docId: string) => void;
  onReindex: (docId: string) => void;
  onView: (docId: string) => void;
}

export function DocumentTable({
  documents,
  loading,
  filterFormat,
  setFilterFormat,
  sortBy,
  setSortBy,
  maxChunks,
  tagColors,
  onDelete,
  onReindex,
  onView,
}: DocumentTableProps) {
  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {["All", "PDF", "DOCX", "PPTX", "Markdown"].map((f) => (
          <button
            key={f}
            onClick={() => setFilterFormat(f)}
            className={`px-3.5 py-1.5 rounded-full border text-[13px] font-medium cursor-pointer transition-all ${filterFormat === f ? "border-primary text-primary bg-primary-100" : "border-[#E8E6E1] bg-white text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary-50"}`}
          >
            {f}
          </button>
        ))}
        <span className="flex-1" />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v!)}>
          <SelectTrigger className="h-auto px-3 py-1.5 border-[#E8E6E1] text-[13px] bg-white text-foreground font-sans cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Newest first">Newest first</SelectItem>
            <SelectItem value="Name A-Z">Name A-Z</SelectItem>
            <SelectItem value="Size">Size</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#E8E6E1] rounded-[16px] overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-16 h-16">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            }
            title="No documents found"
            description="Upload documents to get started with your knowledge base."
            action={
              <Link
                href="/documents"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-colors text-sm"
              >
                Upload Documents
              </Link>
            }
          />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Document", "Tags", "Chunks", "Size", "Indexed", "Date", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 py-3 bg-[#F4F2EF] border-b border-[#E8E6E1] first:rounded-tl-[16px] last:rounded-tr-[16px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const fmt = doc.originalFormat;
                const ready = doc.status === "ready";
                const chunkCount = doc.chunks?.length || 0;
                const chunkPct = Math.min(100, Math.round((chunkCount / maxChunks) * 100));
                return (
                  <tr
                    key={doc.id}
                    className="border-b border-[#F4F2EF] last:border-b-0 hover:bg-[#F3F1FC] transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${getFileIconClass(fmt)}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="w-[18px] h-[18px]"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {doc.originalName.replace(/\.[^.]+$/, "")}
                          </div>
                          <div className="text-xs text-muted-foreground">{doc.originalName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1 flex-wrap">
                        {doc.tags?.map((t) => (
                          <span
                            key={t.id}
                            className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium ${tagColors[t.name] || "bg-primary-100 text-primary"}`}
                          >
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-[60px] h-1.5 bg-[#F4F2EF] rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${chunkPct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{chunkCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-foreground">{formatFileSize(doc.originalSize)}</td>
                    <td className="px-4 py-3.5">
                      {ready ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#16A34A]">
                          ✓ Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#D97706]">
                          <span className="inline-block animate-spin">⟳</span> {doc.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1">
                        <button
                          onClick={() => onView(doc.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#F4F2EF] hover:text-foreground transition-colors"
                          title="View"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onReindex(doc.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#F4F2EF] hover:text-foreground transition-colors"
                          title="Reindex"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onDelete(doc.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-[#FEE2E2] hover:text-[#DC2626] transition-colors"
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
