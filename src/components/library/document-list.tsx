"use client";

import Link from "next/link";
import { TagBadge } from "./tag-badge";
import type { DocumentMeta } from "@/types/documents";

interface DocumentListProps {
  documents: DocumentMeta[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
}

const statusLabels: Record<string, string> = {
  uploading: "Uploading",
  converting: "Converting",
  splitting: "Splitting",
  embedding: "Embedding",
  ready: "Ready",
  failed: "Failed",
};

const statusColors: Record<string, string> = {
  uploading: "bg-[#EFF6FF] text-[#2563EB]",
  converting: "bg-[#FFF7ED] text-[#D97706]",
  splitting: "bg-[#FFF7ED] text-[#D97706]",
  embedding: "bg-[#EFF6FF] text-[#2563EB]",
  ready: "bg-[#DCFCE7] text-[#16A34A]",
  failed: "bg-[#FEE2E2] text-[#DC2626]",
};

function formatSize(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export function DocumentList({ documents, total, page, limit, onPageChange }: DocumentListProps) {
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="bg-white border rounded-[16px] overflow-hidden">
        {documents.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-1">No documents found</p>
            <p className="text-sm">Upload documents to get started.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[#EEEEE9]">
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Name</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Format</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Size</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Status</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Tags</th>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-primary-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/library/${doc.id}`} className="text-sm font-medium text-primary hover:underline">
                      {doc.originalName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground uppercase">{doc.originalFormat}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{formatSize(doc.originalSize)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[doc.status] || ""}`}>
                      {statusLabels[doc.status] || doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {doc.tags?.map((tag) => <TagBadge key={tag.id} name={tag.name} />)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => onPageChange(i + 1)}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                  page === i + 1 ? "bg-primary text-white" : "hover:bg-gray-100"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
