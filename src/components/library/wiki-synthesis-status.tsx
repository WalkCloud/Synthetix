"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";

interface WikiTaskInfo {
  status: string;
  progress: number;
}

/**
 * Independent "knowledge distillation in progress" status bar.
 *
 * Shown BELOW the main processing pipeline on the document detail page.
 * Unlike the pipeline stages (which block document readiness), Wiki
 * synthesis runs async AFTER the doc is ready. This bar lets the user
 * see that distillation is happening without confusing it with the
 * document's own processing status.
 *
 * Polls the latest wiki_synthesize task every 5s while running, then
 * disappears when done (the WikiPrecipCard takes over to show results).
 */
export function WikiSynthesisStatus({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const isZh = locale === "zh-CN";
  const [task, setTask] = useState<WikiTaskInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        // Find the latest wiki_synthesize task for this document
        const res = await fetch(`/api/v1/tasks?status=pending,running&limit=50`);
        if (!res.ok) return;
        const json = await res.json();
        const tasks = json.data || [];
        // Tasks API returns all user tasks; filter for this doc's wiki task.
        // The inputData field contains {docId, taskId} but the list endpoint
        // may not expose it, so we check resultData for the doc id pattern.
        const wikiTask = tasks.find(
          (t: { type: string; docId?: string | null }) =>
            t.type === "wiki_synthesize" && t.docId === documentId
        );

        if (cancelled) return;

        if (wikiTask) {
          setTask({ status: wikiTask.status, progress: wikiTask.progress ?? 0 });
          // Keep polling while running
          if (wikiTask.status === "running" || wikiTask.status === "pending") {
            timer = setTimeout(poll, 5000);
          } else {
            // Completed or failed — stop polling, refresh after a moment
            setTimeout(() => router.refresh(), 2000);
          }
        } else {
          setTask(null);
        }
      } catch {
        // Non-blocking
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentId, router]);

  // Don't render anything if no active wiki task (keeps the page clean)
  if (loading || !task || (task.status !== "running" && task.status !== "pending")) {
    return null;
  }

  const pct = Math.max(0, Math.min(100, task.progress));

  return (
    <div className="bg-card border border-border rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/35 dark:text-violet-300 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {isZh ? "知识提炼进行中" : "Knowledge distillation in progress"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isZh
              ? "正在从文档块中逐个提取并综合知识条目，完成后可在「知识提炼」页面查看。"
              : "Extracting and synthesizing knowledge entries per chunk. Available in Knowledge Wiki when complete."}
          </p>
        </div>
        <span className="text-sm font-bold tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-violet-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
