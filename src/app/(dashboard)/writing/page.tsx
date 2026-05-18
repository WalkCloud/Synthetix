"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { draftStatusLabels, draftStatusColors } from "@/lib/text/status-labels";
import type { DraftMeta } from "@/types/writing";

const statusLabels = draftStatusLabels;
const statusColors: Record<string, string> = {
  drafting: `${draftStatusColors.drafting} border border-orange-200`,
  assembling: `${draftStatusColors.assembling} border border-blue-200`,
  completed: `${draftStatusColors.completed} border border-green-200`,
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
            <h2 className="text-xl font-bold mb-1 text-slate-800">Your Drafts</h2>
            <p className="text-sm text-slate-500">
              {total} draft{total !== 1 ? "s" : ""} — continue writing or start a new draft from brainstorm.
            </p>
          </div>
          <Link
            href="/brainstorm"
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white font-semibold rounded-xl text-sm hover:bg-primary-700 transition-colors shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New from Brainstorm
          </Link>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading...</div>
        ) : drafts.length === 0 ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-soft">
            <p className="text-lg font-semibold text-slate-700 mb-1">No drafts yet</p>
            <p className="text-sm text-slate-500 mb-5">
              Start by brainstorming an outline, then confirm it to create a draft.
            </p>
            <Link
              href="/brainstorm"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-semibold rounded-xl text-sm hover:bg-primary-700 transition-colors shadow-sm"
            >
              Go to Brainstorm
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-soft">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 px-5 py-4">
                    Title
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 px-5 py-4">
                    Status
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 px-5 py-4">
                    Sections
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 px-5 py-4">
                    Last Updated
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 px-5 py-4">
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
                    <tr key={draft.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <button
                          onClick={() => router.push(`/writing/${draft.id}`)}
                          className="text-sm font-semibold text-primary-600 hover:text-primary-700 hover:underline cursor-pointer transition-colors"
                        >
                          {draft.title}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold ${
                            statusColors[draft.status] || ""
                          }`}
                        >
                          {statusLabels[draft.status] || draft.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-slate-600">
                        {completed}/{totalSections} done
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500">
                        {new Date(draft.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => handleDelete(draft.id)}
                          className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
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
