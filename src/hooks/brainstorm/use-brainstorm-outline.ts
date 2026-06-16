import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { deepClone, getByPath, updateByPath, removeByPath, addChildAtPath, renumberSections, numForPath } from "@/lib/outline-tree";
import type { OutlineSection } from "@/lib/outline-tree";
import type { BrainstormOutline, BrainstormSession, Phase } from "./types";
import { useLocale } from "@/lib/i18n";

const POLL_INTERVAL = 1000;

interface UseBrainstormOutlineOptions {
  activeId: string | null;
  outline: BrainstormOutline | null;
  setOutline: (o: BrainstormOutline | null) => void;
  setStatus: (s: string) => void;
  setPhase: (p: Phase) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<BrainstormSession[]>>;
  setOutlineTaskId: (id: string | null) => void;
}

export function useBrainstormOutline({
  activeId, outline, setOutline, setStatus, setPhase,
  loading, setLoading, setSessions, setOutlineTaskId,
}: UseBrainstormOutlineOptions) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [editSections, setEditSections] = useState<OutlineSection[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [sectionNotes, setSectionNotes] = useState<{ num: string; title: string; notes: string }[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const pollingTaskIdRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const backoffRef = useRef(POLL_INTERVAL);
  const MAX_RETRIES = 3;
  const MAX_BACKOFF = 12000;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function persistOutline(updatedOutline: BrainstormOutline | null) {
    if (!activeId || !updatedOutline) return;
    await fetch(`/api/v1/brainstorm/outlines/${activeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outline: updatedOutline }),
    }).catch(() => {});
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const resetPolling = useCallback(() => {
    stopPolling();
    pollingTaskIdRef.current = null;
    retryCountRef.current = 0;
    backoffRef.current = POLL_INTERVAL;
  }, [stopPolling]);

  const startPolling = useCallback((taskId: string) => {
    // Idempotent guard: don't start a new poll cycle for the same task
    if (pollingTaskIdRef.current === taskId) return;

    stopPolling();
    pollingTaskIdRef.current = taskId;
    retryCountRef.current = 0;
    backoffRef.current = POLL_INTERVAL;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/tasks/${taskId}`);
        const d = await res.json();
        if (!d.success) {
          resetPolling();
          setIsGeneratingOutline(false);
          setLoading(false);
          return;
        }

        const task = d.data;
        if (pollingTaskIdRef.current !== taskId) return;

        if (task.status === "completed" && task.result) {
          resetPolling();
          const generatedOutline = task.result.outline;
          const generatedTitle = task.result.title;
          const currentActiveId = activeIdRef.current;
          if (generatedOutline) {
            setOutline(generatedOutline);
            setStatus(t.brainstorm.status.complete);
            setPhase("ready");
            if (currentActiveId) {
              setSessions((prev) => prev.map((s) => s.id === currentActiveId ? { ...s, title: generatedTitle || t.brainstorm.defaultSessionTitle } : s));
            }
          }
          setIsGeneratingOutline(false);
          setLoading(false);
        } else if (task.status === "failed" || task.status === "cancelled") {
          resetPolling();
          setIsGeneratingOutline(false);
          setLoading(false);
          if (task.status === "failed") {
            console.warn("Outline generation failed:", task.error);
          }
        } else {
          // Still pending/running — schedule next poll with backoff
          retryCountRef.current = 0; // reset retry count on success
          backoffRef.current = Math.min(backoffRef.current * 1.3, MAX_BACKOFF);
          pollRef.current = setTimeout(poll, backoffRef.current);
        }
      } catch {
        // Network error — retry with backoff, up to MAX_RETRIES
        retryCountRef.current += 1;
        if (retryCountRef.current > MAX_RETRIES) {
          resetPolling();
          setIsGeneratingOutline(false);
          setLoading(false);
          return;
        }
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
        pollRef.current = setTimeout(poll, backoffRef.current);
      }
    };

    pollRef.current = setTimeout(poll, POLL_INTERVAL);
  }, [
    setLoading, setOutline, setPhase, setSessions, setStatus,
    stopPolling, resetPolling,
    t.brainstorm.defaultSessionTitle, t.brainstorm.status.complete,
  ]);

  const generateOutline = useCallback(async () => {
    if (!activeId) return;
    setOutlineError(null);
    setLoading(true); setIsGeneratingOutline(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST", headers: { "x-locale": locale } });
      const d = await res.json();
      if (d.success && d.data?.taskId) {
        startPolling(d.data.taskId);
      } else {
        setOutlineError("Failed to start outline generation. Please retry.");
        setIsGeneratingOutline(false); setLoading(false);
      }
    } catch {
      setOutlineError("Network error while starting outline generation.");
      setIsGeneratingOutline(false); setLoading(false);
    }
  }, [activeId, locale, setLoading, startPolling]);

  const startPollingExternal = useCallback((taskId: string) => {
    setIsGeneratingOutline(true);
    setLoading(true);
    startPolling(taskId);
  }, [setLoading, startPolling]);

  async function clearOutline() {
    if (!activeId || loading) return;
    resetPolling();
    setIsGeneratingOutline(false);
    setOutlineTaskId(null);
    setOutlineError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearOutline" }),
      });
      const d = await res.json();
      if (d.success) {
        setOutline(null); setStatus(t.brainstorm.status.active); setPhase("gathering"); setSectionNotes([]);
      } else {
        setOutlineError("Failed to clear outline. Please retry.");
      }
    } catch {
      setOutlineError("Network error while clearing outline.");
    } finally { setLoading(false); }
  }

  async function regenerateOutline() {
    if (!activeId || loading) return;
    resetPolling();
    setOutlineTaskId(null);
    setOutline(null);
    setPhase("ready");
    setOutlineError(null);
    setIsGeneratingOutline(true);
    setLoading(true);
    try {
      const clearRes = await fetch(`/api/v1/brainstorm/sessions/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearOutline" }),
      });
      const clearData = await clearRes.json();
      if (!clearData.success) throw new Error("Failed to clear outline");

      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, {
        method: "POST",
        headers: { "x-locale": locale },
      });
      const d = await res.json();
      if (d.success && d.data?.taskId) {
        startPolling(d.data.taskId);
        return;
      }

      throw new Error("Failed to start outline generation");
    } catch {
      setOutlineError("Failed to regenerate outline. Please retry.");
      setIsGeneratingOutline(false);
      setLoading(false);
      setPhase("ready");
    }
  }

  async function confirmAndWrite() {
    if (!activeId || !outline || confirming) return;
    setConfirming(true);
    try {
      await persistOutline(outline);
      const res = await fetch("/api/v1/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeId, outline }),
      });
      const d = await res.json();
      if (d.success && d.data?.id) {
        router.push(`/writing/${d.data.id}`);
      }
    } finally { setConfirming(false); }
  }

  function startEditing() {
    if (!outline) return;
    setEditTitle(outline.title);
    setEditSections(deepClone(outline.sections));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false); setEditSections([]); setEditTitle("");
  }

  function saveEditing() {
    if (!outline) return;
    const renumbered = renumberSections(editSections);
    const updated = { ...outline, title: editTitle, sections: renumbered };
    setOutline(updated); setEditing(false);
    persistOutline(updated);
  }

  function updateEditNode(path: number[], field: "title" | "estimatedWords", value: string) {
    setEditSections((prev) =>
      updateByPath(prev, path, (s) =>
        field === "estimatedWords" ? { ...s, estimatedWords: parseInt(value) || 0 } : { ...s, [field]: value })
    );
  }

  function removeEditNode(path: number[]) {
    setEditSections((prev) => removeByPath(prev, path));
  }

  function addEditChild(parentPath: number[]) {
    const parent = getByPath(editSections, parentPath);
    const childCount = parent?.children?.length || 0;
    const parentNum = parentPath.length > 0 ? numForPath(editSections, parentPath) : String(editSections.length + 1);
    const childNum = `${parentNum}.${childCount + 1}`;
    setEditSections((prev) =>
      addChildAtPath(prev, parentPath, { num: childNum, title: "", estimatedWords: 200 })
    );
  }

  function addEditSection() {
    setEditSections((prev) => [...prev, { num: String(prev.length + 1), title: "", estimatedWords: 500 }]);
  }

  function totalWords(): number {
    return sumWords(outline?.sections);
  }

  function sumWords(sections?: OutlineSection[]): number {
    if (!sections) return 0;
    return sections.reduce((sum, s) => sum + (s.estimatedWords || 0) + sumWords(s.children), 0);
  }

  return {
    isGeneratingOutline, confirming, editing, outlineError, editSections, editTitle, setEditTitle,
    sectionNotes,
    generateOutline, clearOutline, regenerateOutline, confirmAndWrite,
    startEditing, cancelEditing, saveEditing,
    updateEditNode, removeEditNode, addEditChild, addEditSection,
    totalWords, startPollingExternal, stopPolling,
  };
}
