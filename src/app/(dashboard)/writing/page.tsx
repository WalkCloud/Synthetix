"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";
import { draftStatusLabels, draftStatusColors } from "@/lib/text/status-labels";
import type { DraftMeta } from "@/types/writing";
import { useLocale } from "@/lib/i18n";

interface DraftGenerationTask {
  id: string;
  type: string;
  status: string;
  progress: number;
  draftId: string | null;
  result?: {
    draftId?: string;
    generated?: number;
    total?: number;
    currentSectionTitle?: string | null;
    skipped?: number;
  } | null;
  error?: string | null;
  updatedAt: string;
}

const statusLabels = draftStatusLabels;
const statusColors: Record<string, string> = {
  drafting: `${draftStatusColors.drafting} border border-orange-200`,
  completed: `${draftStatusColors.completed} border border-green-200`,
};

function generationLabel(
  task: DraftGenerationTask | undefined,
  completed: number,
  total: number,
) {
  if (task?.status === "pending") return "Queued";
  if (task?.status === "running") return "Generating";
  if (total > 0 && completed < total) return "In Progress";
  if (total > 0 && completed >= total) return "Completed";
  if (task?.status === "failed") return "Failed";
  if (task?.status === "cancelled") return "Stopped";
  return "Idle";
}

function generationColor(
  task: DraftGenerationTask | undefined,
  completed: number,
  total: number,
) {
  if (task?.status === "pending" || task?.status === "running") return "text-primary-600";
  if (total > 0 && completed < total) return "text-orange-600";
  if (total > 0 && completed >= total) return "text-green-600";
  if (task?.status === "failed") return "text-red-600";
  if (task?.status === "cancelled") return "text-muted-foreground";
  return "text-muted-foreground";
}

function taskColor(task?: DraftGenerationTask) {
  if (!task) return "text-muted-foreground";
  if (task.status === "pending" || task.status === "running") return "text-primary-600";
  if (task.status === "completed") return "text-green-600";
  if (task.status === "failed") return "text-red-600";
  if (task.status === "cancelled") return "text-muted-foreground";
  return "text-muted-foreground";
}

export default function WritingListPage() {
  const { t } = useLocale();
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [tasks, setTasks] = useState<DraftGenerationTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const router = useRouter();

  const fetchPageData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const [draftRes, taskRes] = await Promise.all([
      fetch("/api/v1/drafts"),
      fetch("/api/v1/tasks?limit=100"),
    ]);
    const draftData = await draftRes.json();
    const taskData = await taskRes.json();
    if (draftData.success && Array.isArray(draftData.data)) {
      setDrafts(draftData.data);
      setTotal(draftData.total ?? 0);
    }
    if (taskData.success && Array.isArray(taskData.data)) {
      setTasks(
        taskData.data.filter(
          (task: DraftGenerationTask) =>
            task.type === "draft_generate_all" && task.draftId,
        ),
      );
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => { fetchPageData(true); }, [fetchPageData]);

  const activeTasks = tasks.filter((task) =>
    task.status === "pending" || task.status === "running"
  );

  useEffect(() => {
    if (activeTasks.length === 0) return;
    const interval = setInterval(() => fetchPageData(false), 3000);
    return () => clearInterval(interval);
  }, [activeTasks.length, fetchPageData]);

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/v1/drafts/${id}`, { method: "DELETE" });
      if (res.ok) fetchPageData(false);
    },
    [fetchPageData]
  );

  const handleStopTask = useCallback(async (taskId: string) => {
    setStoppingTaskId(taskId);
    try {
      await fetch(`/api/v1/tasks/${taskId}`, { method: "POST" });
      await fetchPageData(false);
    } finally {
      setStoppingTaskId(null);
    }
  }, [fetchPageData]);

  const activeDraftIds = new Set(
    activeTasks
      .map((task) => task.draftId)
      .filter((draftId): draftId is string => Boolean(draftId)),
  );
  const taskByDraftId = new Map<string, DraftGenerationTask>();
  tasks.forEach((task) => {
    if (task.draftId && !taskByDraftId.has(task.draftId)) {
      taskByDraftId.set(task.draftId, task);
    }
  });

  return (
    <div>
      <Header title={t.writing.title} />
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold mb-1 text-foreground">{t.dashboard.recent.recentDrafts}</h2>
            <p className="text-sm text-muted-foreground">
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
            {t.brainstorm.title}
          </Link>
        </div>

        {loading ? (
          <LoadingState />
        ) : drafts.length === 0 ? (
          <div className="p-12 text-center bg-card border border-border rounded-2xl shadow-soft">
            <p className="text-lg font-semibold text-foreground/75 mb-1">{t.dashboard.empty.noDrafts}</p>
            <p className="text-sm text-muted-foreground mb-5">
              Start by brainstorming an outline, then confirm it to create a draft.
            </p>
            <Link
              href="/brainstorm"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-semibold rounded-xl text-sm hover:bg-primary-700 transition-colors shadow-sm"
            >
              {t.layout.sidebar.mindOrganization}
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-soft">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Title
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Status
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Sections
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Generation
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Last Updated
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 py-4">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const progress = draft.progress || { completed: 0, total: 0 };
                  const completed = progress.completed;
                  const totalSections = progress.total;
                  const task = taskByDraftId.get(draft.id);
                  const taskResult = task?.result || {};
                  const isTaskActive = activeDraftIds.has(draft.id);

                  return (
                    <tr key={draft.id} className="border-b border-border last:border-0 hover:bg-secondary/70 transition-colors">
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
                      <td className="px-5 py-4 text-sm font-medium text-muted-foreground">
                        <div>{completed}/{totalSections} done</div>
                        <div className="mt-1 h-1.5 max-w-[180px] overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary-600 transition-all duration-500"
                            style={{
                              width: `${totalSections > 0 ? Math.round((completed / totalSections) * 100) : 0}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className={`text-xs font-semibold ${generationColor(task, completed, totalSections)}`}>
                          {generationLabel(task, completed, totalSections)}
                          {isTaskActive ? ` · ${task?.progress ?? 0}%` : ""}
                        </div>
                        <div className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground">
                          {task?.status === "failed" && task.error
                            ? task.error
                            : taskResult.currentSectionTitle
                              ? `Current: ${taskResult.currentSectionTitle}`
                              : taskResult.total
                                ? `${taskResult.generated ?? 0}/${taskResult.total} generated`
                                : "Open the draft to review generated sections"}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted-foreground">
                        {new Date(draft.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => router.push(`/writing/${draft.id}`)}
                            className="text-sm font-medium text-foreground/75 hover:text-foreground hover:bg-secondary px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            View
                          </button>
                          {task && isTaskActive && (
                            <button
                              onClick={() => handleStopTask(task.id)}
                              disabled={stoppingTaskId === task.id}
                              className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {stoppingTaskId === task.id ? "Stopping..." : "Stop"}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(draft.id)}
                            disabled={isTaskActive}
                            className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
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
