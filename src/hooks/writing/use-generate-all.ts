"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getLocalizedError } from "@/lib/i18n";

interface GenerateAllTask {
  id: string;
  type: string;
  status: string;
  progress: number;
  result?: {
    generated?: number;
    total?: number;
    currentSectionId?: string | null;
    currentSectionTitle?: string | null;
  } | null;
  error?: string | null;
}

interface GenerateAllTaskFull extends GenerateAllTask {
  draftId?: string | null;
}

export function useGenerateAll(
  id: string,
  setActiveSectionId: (id: string | null) => void,
  loadDraft: () => Promise<void>,
) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<GenerateAllTask | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function findRunning() {
      try {
        const res = await fetch("/api/v1/tasks?status=pending,running&limit=50");
        const data = await res.json();
        if (!data.success || stopped) return;
        const found = (data.data || []).find(
          (item: GenerateAllTaskFull) =>
            item.type === "draft_generate_all" && item.draftId === id,
        );
        if (found) {
          setTaskId(found.id);
          setTask(found);
          if (found.result?.currentSectionId) {
            setActiveSectionId(found.result.currentSectionId);
          }
        }
      } catch {}
    }
    findRunning();
    return () => { stopped = true; };
  }, [id, setActiveSectionId]);

  useEffect(() => {
    if (!taskId) return;
    let stopped = false;
    async function pollTask() {
      try {
        const res = await fetch(`/api/v1/tasks/${taskId}`);
        const data = await res.json();
        if (!data.success || stopped) return;
        const t = data.data as GenerateAllTask;
        setTask(t);
        if (t.result?.currentSectionId) {
          setActiveSectionId(t.result.currentSectionId);
        }
        await loadDraft();
        if (["completed", "failed", "cancelled"].includes(t.status)) {
          setTaskId(null);
        }
      } catch {}
    }
    pollTask();
    const interval = setInterval(pollTask, 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [taskId, loadDraft, setActiveSectionId]);

  const start = useCallback(async (modelConfigId?: string) => {
    setIsStarting(true);
    try {
      const res = await fetch(`/api/v1/drafts/${id}/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overwrite: false,
          stopOnError: true,
          modelConfigId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(getLocalizedError(data));
        return;
      }
      setTaskId(data.data.taskId);
      setTask({
        id: data.data.taskId,
        type: "draft_generate_all",
        status: data.data.status || "pending",
        progress: data.data.progress ?? 0,
      });
      await loadDraft();
    } catch (error) {
      toast.error(getLocalizedError({ error: error instanceof Error ? error.message : undefined }));
    } finally {
      setIsStarting(false);
    }
  }, [id, loadDraft]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        toast.error(getLocalizedError(data));
        return;
      }
      setTask((prev) => prev ? { ...prev, status: "cancelled" } : prev);
      await loadDraft();
    } catch (error) {
      toast.error(getLocalizedError({ error: error instanceof Error ? error.message : undefined }));
    } finally {
      setIsCancelling(false);
    }
  }, [taskId, loadDraft]);

  const isRunning = task?.status === "pending" || task?.status === "running";

  return { task, isRunning, isStarting, isCancelling, start, cancel };
}
