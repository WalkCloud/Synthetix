"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import type { DraftMeta } from "@/types/writing";

const statusLabels: Record<string, string> = {
  drafting: "In Progress",
  assembling: "Assembling",
  completed: "Completed",
};

const statusColors: Record<string, string> = {
  drafting: "bg-[#FFF7ED] text-[#D97706]",
  assembling: "bg-[#EFF6FF] text-[#2563EB]",
  completed: "bg-[#DCFCE7] text-[#16A34A]",
};

export default function WritingListPage() {
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/v1/drafts");
    const data = await res.json();
    if (data.success) {
      setDrafts(data.data);
      setTotal(data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/v1/drafts/${id}`, { method: "DELETE" });
      if (res.ok) fetchDrafts();
    },
    [fetchDrafts]
  );

  return (
    <div>
      <Header title="Document Writing" />
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold mb-1">Your Drafts</h2>
            <p className="text-sm text-[#A1A1AA]">
              {total} draft{total !== 1 ? "s" : ""} — continue writing or start a new draft from brainstorm.
            </p>
          </div>
          <Link
            href="/brainstorm"
            className="flex items-center gap-2 px-4 py-2 bg-[#4361EE] text-white font-semibold rounded-xl text-sm hover:bg-[#3651D4] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New from Brainstorm
          </Link>
        </div>

        {loading ? (
          <div className="p-12 text-center text-[#A1A1AA]">Loading...</div>
        ) : drafts.length === 0 ? (
          <div className="p-12 text-center bg-white border border-[#E4E4E7] rounded-[16px]">
            <p className="text-lg font-medium text-[#52525B] mb-1">No drafts yet</p>
            <p className="text-sm text-[#A1A1AA] mb-4">
              Start by brainstorming an outline, then confirm it to create a draft.
            </p>
            <Link
              href="/brainstorm"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#4361EE] text-white font-semibold rounded-xl text-sm hover:bg-[#3651D4] transition-colors"
            >
              Go to Brainstorm
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-[#E4E4E7] rounded-[16px] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-[#EEEEE9]">
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] px-4 py-3">
                    Title
                  </th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] px-4 py-3">
                    Status
                  </th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] px-4 py-3">
                    Sections
                  </th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] px-4 py-3">
                    Last Updated
                  </th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#A1A1AA] px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const progress = draft.progress || { completed: 0, total: 0 };
                  const completed = progress.completed;
                  const totalSections = progress.total;

                  return (
                    <tr key={draft.id} className="border-b last:border-0 hover:bg-[#F5F6FE]/50">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => router.push(`/writing/${draft.id}`)}
                          className="text-sm font-medium text-[#4361EE] hover:underline cursor-pointer"
                        >
                          {draft.title}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            statusColors[draft.status] || ""
                          }`}
                        >
                          {statusLabels[draft.status] || draft.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#52525B]">
                        {completed}/{totalSections} done
                      </td>
                      <td className="px-4 py-3 text-sm text-[#A1A1AA]">
                        {new Date(draft.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(draft.id)}
                          className="text-sm text-[#DC2626] hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
