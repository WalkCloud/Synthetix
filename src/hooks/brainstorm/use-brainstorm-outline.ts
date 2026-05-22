import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { deepClone, getByPath, updateByPath, removeByPath, addChildAtPath, renumberSections, numForPath } from "@/lib/outline-tree";
import type { OutlineSection } from "@/lib/outline-tree";
import type { BrainstormOutline, Phase } from "./types";

interface UseBrainstormOutlineOptions {
  activeId: string | null;
  outline: BrainstormOutline | null;
  setOutline: (o: BrainstormOutline | null) => void;
  setStatus: (s: string) => void;
  setPhase: (p: Phase) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setSessions: React.Dispatch<React.SetStateAction<{ id: string; title: string }[]>>;
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

  async function persistOutline(updatedOutline: BrainstormOutline | null) {
    if (!activeId || !updatedOutline) return;
    await fetch(`/api/v1/brainstorm/outlines/${activeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outline: updatedOutline }),
    }).catch(() => {});
  }

  const generateOutline = useCallback(async () => {
    if (!activeId) return;
    setLoading(true); setIsGeneratingOutline(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST" });
      const d = await res.json();
      if (d.success) {
        setOutline(d.data);
        setStatus("Complete");
        setPhase("ready");
        setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, title: d.data.title || "New Brainstorming Session" } : s));
      }
    } finally {
      setIsGeneratingOutline(false); setLoading(false);
    }
  }, [activeId]);

  async function clearOutline() {
    if (!activeId || loading) return;
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
    totalWords,
  };
}
