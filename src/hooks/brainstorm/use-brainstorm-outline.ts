import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { deepClone, getByPath, updateByPath, removeByPath, addChildAtPath, renumberSections, numForPath } from "@/lib/outline-tree";
import type { OutlineSection } from "@/lib/outline-tree";
import type { BrainstormOutline, BrainstormSession, Phase } from "./types";

const POLL_INTERVAL = 2000;

interface UseBrainstormOutlineOptions {
  activeId: string | null;
  outline: BrainstormOutline | null;
  setOutline: (o: BrainstormOutline | null) => void;
  setStatus: (s: string) => void;
  setPhase: (p: Phase) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<BrainstormSession[]>>;
  scrollToEnd: () => void;
}

export function useBrainstormOutline({
  activeId, outline, setOutline, setStatus, setPhase,
  loading, setLoading, setSessions, scrollToEnd,
}: UseBrainstormOutlineOptions) {
  const router = useRouter();
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSections, setEditSections] = useState<OutlineSection[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [sectionNotes, setSectionNotes] = useState<{ num: string; title: string; notes: string }[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

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

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(taskId: string) {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/tasks/${taskId}`);
        const d = await res.json();
        if (!d.success) { stopPolling(); setIsGeneratingOutline(false); setLoading(false); return; }

        const task = d.data;
        if (task.status === "completed" && task.result) {
          stopPolling();
          const generatedOutline = task.result.outline;
          const generatedTitle = task.result.title;
          const currentActiveId = activeIdRef.current;
          if (generatedOutline) {
            setOutline(generatedOutline);
            setStatus("Complete");
            setPhase("ready");
            if (currentActiveId) {
              setSessions((prev) => prev.map((s) => s.id === currentActiveId ? { ...s, title: generatedTitle || "New Brainstorming Session" } : s));
            }
          }
          setIsGeneratingOutline(false);
          setLoading(false);
        } else if (task.status === "failed") {
          stopPolling();
          setIsGeneratingOutline(false);
          setLoading(false);
          console.error("Outline generation failed:", task.error);
        } else if (task.status === "cancelled") {
          stopPolling();
          setIsGeneratingOutline(false);
          setLoading(false);
        }
      } catch {
        stopPolling();
        setIsGeneratingOutline(false);
        setLoading(false);
      }
    }, POLL_INTERVAL);
  }

  const generateOutline = useCallback(async () => {
    if (!activeId) return;
    setLoading(true); setIsGeneratingOutline(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST" });
      const d = await res.json();
      if (d.success && d.data?.taskId) {
        startPolling(d.data.taskId);
      } else {
        setIsGeneratingOutline(false); setLoading(false);
      }
    } catch {
      setIsGeneratingOutline(false); setLoading(false);
    }
  }, [activeId]);

  function startPollingExternal(taskId: string) {
    setIsGeneratingOutline(true);
    setLoading(true);
    startPolling(taskId);
  }

  async function clearOutline() {
    if (!activeId || loading) return;
    stopPolling();
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearOutline" }),
      });
      const d = await res.json();
      if (d.success) { setOutline(null); setStatus("Active"); setPhase("gathering"); setSectionNotes([]); }
    } finally { setLoading(false); }
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
    isGeneratingOutline, confirming, editing, editSections, editTitle, setEditTitle,
    sectionNotes,
    generateOutline, clearOutline, confirmAndWrite,
    startEditing, cancelEditing, saveEditing,
    updateEditNode, removeEditNode, addEditChild, addEditSection,
    totalWords, startPollingExternal, stopPolling,
  };
}
