"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { renderAIContent } from "@/components/shared/markdown-renderer";
import { deepClone, getByPath, updateByPath, removeByPath, addChildAtPath, renumberSections, numForPath } from "@/lib/outline-tree";
import type { OutlineSection } from "@/lib/outline-tree";
import {
  MessageSquare, LayoutList, Plus, Send, RefreshCw,
  Bot, User, Edit3, Loader2, Sparkles, Paperclip,
  Trash2, Check, X, GripVertical, FileText
} from "lucide-react";

interface Session {
  id: string;
  title: string;
  status: string;
  outline: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface Message {
  id: string;
  sessionId: string;
  role: "user" | "ai" | "system";
  content: string;
  createdAt: string;
}

interface Outline {
  title: string;
  sections: OutlineSection[];
}

export default function BrainstormPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editSections, setEditSections] = useState<OutlineSection[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/v1/brainstorm/sessions")
      .then((r) => r.json())
      .then((d) => { if (d.success) setSessions(d.data); });
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id); setLoading(true);
    const res = await fetch(`/api/v1/brainstorm/sessions/${id}`);
    const d = await res.json();
    if (d.success) {
      setMessages(d.data.messages || []);
      setOutline(d.data.outline ? JSON.parse(d.data.outline) : null);
      setStatus(d.data.status === "active" ? "Active" : "Complete");
    }
    setLoading(false);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  async function createSession() {
    const res = await fetch("/api/v1/brainstorm/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Brainstorming Session" }),
    });
    const d = await res.json();
    if (d.success) {
      setSessions((prev) => [d.data, ...prev]);
      loadSession(d.data.id);
    }
  }

  function startRenaming(s: Session) {
    setRenamingId(s.id);
    setRenameValue(s.title);
  }

  async function commitRename(id: string) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    const res = await fetch(`/api/v1/brainstorm/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", title: trimmed }),
    });
    const d = await res.json();
    if (d.success) {
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: trimmed } : s));
    }
  }

  async function deleteSession(id: string) {
    const res = await fetch(`/api/v1/brainstorm/sessions/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.success) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setOutline(null);
        setStatus("");
      }
    }
  }

  async function handleFileUpload(file: File) {
    if (!activeId || loading) return;
    setLoading(true);

    const optSystem: Message = { id: "opt-sys", sessionId: activeId, role: "system", content: `Uploading document "${file.name}" and extracting content...`, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optSystem]);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/upload`, { method: "POST", body: formData });
      const d = await res.json();

      if (d.success) {
        // Reload to show the uploaded content as user message
        await loadSession(activeId);
        // Trigger AI to respond to the uploaded document
        const aiRes = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Please give me an outline suggestion based on the uploaded document." }),
        });
        const aiData = await aiRes.json();
        if (aiData.success) {
          await loadSession(activeId);
          if (aiData.data.outlineRequested) {
            await generateOutline();
          }
        }
        fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
      } else {
        setMessages((prev) => [...prev.filter((m) => m.id !== "opt-sys"), { id: "err", sessionId: activeId, role: "system", content: `Upload failed: ${d.error}`, createdAt: new Date().toISOString() }]);
        setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev.filter((m) => m.id !== "opt-sys"), { id: "err", sessionId: activeId, role: "system", content: "Upload failed, please try again.", createdAt: new Date().toISOString() }]);
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || !activeId || loading) return;
    const content = input; setInput(""); setLoading(true);

    const optMsg: Message = { id: "opt", sessionId: activeId, role: "user", content, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optMsg]);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 50);

    const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const d = await res.json();
    if (d.success) {
      setMessages((prev) => [...prev.filter((m) => m.id !== "opt"), d.data.message]);
      if (d.data.outlineRequested) {
        await generateOutline();
      } else {
        setLoading(false);
      }
      fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
    } else {
      setLoading(false);
    }
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function generateOutline() {
    if (!activeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST" });
      const d = await res.json();
      if (d.success) { 
        setOutline(d.data); 
        setStatus("Complete"); 
        setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, title: d.data.title || "New Brainstorming Session" } : s));
      }
    } finally {
      setLoading(false);
    }
  }

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
      if (d.success) { setOutline(null); setStatus("Active"); }
    } finally {
      setLoading(false);
    }
  }

  async function confirmAndWrite() {
    if (!activeId || !outline || confirming) return;
    setConfirming(true);
    try {
      // Persist latest outline before creating draft
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
    } finally {
      setConfirming(false);
    }
  }

  function totalWords(): number {
    return sumWords(outline?.sections);
  }

  function sumWords(sections?: OutlineSection[]): number {
    if (!sections) return 0;
    return sections.reduce((sum, s) => sum + (s.estimatedWords || 0) + sumWords(s.children), 0);
  }

  function formatTime(d: string): string {
    return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  const activeSession = sessions.find((s) => s.id === activeId);
  const activeMessageCount = activeSession?._count?.messages ?? messages.length;
  const displayStatus = outline ? "Outline Ready" : status === "Complete" ? "Complete" : "Deepening Phase";

  function startEditing() {
    if (!outline) return;
    setEditTitle(outline.title);
    setEditSections(deepClone(outline.sections));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditSections([]);
    setEditTitle("");
  }

  function saveEditing() {
    if (!outline) return;
    const renumbered = renumberSections(editSections);
    const updated = { ...outline, title: editTitle, sections: renumbered };
    setOutline(updated);
    setEditing(false);
    persistOutline(updated);
  }

  async function persistOutline(updatedOutline: typeof outline) {
    if (!activeId || !updatedOutline) return;
    await fetch(`/api/v1/brainstorm/outlines/${activeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outline: updatedOutline }),
    }).catch(() => {});
  }

  function updateEditNode(path: number[], field: "title" | "estimatedWords", value: string) {
    setEditSections((prev) =>
      updateByPath(prev, path, (s) =>
        field === "estimatedWords" ? { ...s, estimatedWords: parseInt(value) || 0 } : { ...s, [field]: value }
      )
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
    setEditSections((prev) => [
      ...prev,
      { num: String(prev.length + 1), title: "", estimatedWords: 500 },
    ]);
  }

  function insertSectionAfter(index: number) {
    if (!outline) return;
    const section: OutlineSection = { num: "", title: "", estimatedWords: 500 };
    const updated = [...outline.sections.slice(0, index + 1), section, ...outline.sections.slice(index + 1)];
    const newOutline = { ...outline, sections: renumberSections(updated) };
    setOutline(newOutline);
    persistOutline(newOutline);
  }

  function updateNodeTitle(path: number[], title: string) {
    if (!outline) return;
    const updated = updateByPath(outline.sections, path, (s) => ({ ...s, title }));
    setOutline({ ...outline, sections: updated });
  }

  function removeNode(path: number[]) {
    if (!outline) return;
    const updated = removeByPath(outline.sections, path);
    const newOutline = { ...outline, sections: renumberSections(updated) };
    setOutline(newOutline);
    persistOutline(newOutline);
  }

  function insertChildAfter(parentPath: number[], childIndex: number) {
    if (!outline) return;
    const updated = addChildAtPath(outline.sections, [...parentPath, childIndex], { num: "", title: "", estimatedWords: 200 });
    const newOutline = { ...outline, sections: renumberSections(updated) };
    setOutline(newOutline);
    persistOutline(newOutline);
  }

  function reorderSections(from: number, to: number) {
    if (!outline || from === to) return;
    const updated = [...outline.sections];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    const newOutline = { ...outline, sections: renumberSections(updated) };
    setOutline(newOutline);
    persistOutline(newOutline);
  }

  function EditOutlineNode({ section, path, onUpdate, onRemove, onAddChild, depth }: {
    section: OutlineSection;
    path: number[];
    onUpdate: (path: number[], field: "title" | "estimatedWords", value: string) => void;
    onRemove: (path: number[]) => void;
    onAddChild: (parentPath: number[]) => void;
    depth: number;
  }) {
    const isTop = depth === 0;
    const indent = depth > 0 ? `pl-${Math.min(depth * 4, 12)}` : "";

    return (
      <div className={isTop ? "rounded-[12px] border bg-white shadow-sm overflow-hidden" : undefined}>
        <div className={`flex items-center gap-2 ${isTop ? "p-3" : "py-2 pr-1"} ${indent}`}>
          {isTop && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className={`shrink-0 ${isTop ? "w-5 text-sm font-bold" : "min-w-6 text-xs font-semibold"} text-primary`}>
            {section.num}
          </span>
          <input
            type="text"
            value={section.title}
            onChange={(e) => onUpdate(path, "title", e.target.value)}
            placeholder={isTop ? "Section title..." : "Sub-section title..."}
            className={`min-w-0 flex-1 bg-transparent text-foreground focus:outline-none ${isTop ? "text-sm font-semibold" : "text-[13px] border-b border-dashed border-slate-300 focus:border-primary-400"}`}
          />
          <input
            type="text"
            inputMode="numeric"
            value={section.estimatedWords || ""}
            onChange={(e) => onUpdate(path, "estimatedWords", e.target.value)}
            className={`shrink-0 rounded ${isTop ? "w-16 rounded-lg border bg-slate-50 px-2 py-1 text-xs focus:ring-2 focus:ring-primary/20" : "w-14 border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] focus:ring-1 focus:ring-primary/20"} text-center text-muted-foreground focus:outline-none`}
            placeholder="words"
          />
          <button
            onClick={() => onRemove(path)}
            className={`flex shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-red-500 ${isTop ? "h-7 w-7 rounded-lg hover:bg-red-50 hover:text-red-600" : "h-6 w-6"}`}
          >
            {isTop ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
        {isTop && section.children && section.children.length > 0 && (
          <div className="border-t bg-slate-50/50 p-2 space-y-2">
            {section.children.map((child, ci) => (
              <EditOutlineNode
                key={ci}
                section={child}
                path={[...path, ci]}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
        {!isTop && section.children && section.children.length > 0 && (
          <div className="space-y-1">
            {section.children.map((child, ci) => (
              <EditOutlineNode
                key={ci}
                section={child}
                path={[...path, ci]}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
        {(isTop || (section.children && section.children.length > 0)) && (
          <div className={`${isTop ? "pl-6 pt-1 pb-1" : "pl-4 pt-0.5 pb-0.5"}`}>
            <button
              onClick={() => onAddChild(path)}
              className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-primary/60 hover:text-primary transition-colors"
            >
              <Plus className="h-3 w-3" /> Add Sub-section
            </button>
          </div>
        )}
        {!isTop && !section.children?.length && (
          <div className="pl-4 pt-0.5 pb-0.5">
            <button
              onClick={() => onAddChild(path)}
              className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-primary/50 hover:text-primary transition-colors"
            >
              <Plus className="h-2.5 w-2.5" /> Add Sub-section
            </button>
          </div>
        )}
      </div>
    );
  }

  function DisplayOutlineNode({ section, path, depth, isDraggable, dragIndex, setDragIndex, onReorder, onUpdateTitle, onRemove, onInsertChild, onAddChild, onInsertAfter }: {
    section: OutlineSection;
    path: number[];
    depth: number;
    isDraggable: boolean;
    dragIndex: number | null;
    setDragIndex: (i: number | null) => void;
    onReorder: (from: number, to: number) => void;
    onUpdateTitle: (path: number[], title: string) => void;
    onRemove: (path: number[]) => void;
    onInsertChild: (parentPath: number[], childIndex: number) => void;
    onAddChild: (parentPath: number[]) => void;
    onInsertAfter: (path: number[]) => void;
  }) {
    const isTop = depth === 0;

    if (isTop) {
      return (
        <li
          draggable={isDraggable}
          onDragStart={() => isDraggable && setDragIndex(path[0])}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary", "bg-primary-50/30"); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove("border-primary", "bg-primary-50/30"); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-primary", "bg-primary-50/30"); if (dragIndex !== null && isDraggable) onReorder(dragIndex, path[0]); setDragIndex(null); }}
          onDragEnd={() => setDragIndex(null)}
          className={`group/section rounded-[12px] border bg-white shadow-sm transition ${dragIndex === path[0] ? "opacity-40" : ""}`}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            {isDraggable && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/30 transition group-hover/section:text-muted-foreground" />}
            <span className="min-w-5 shrink-0 text-sm font-bold text-primary">{section.num}.</span>
            <input
              value={section.title}
              onChange={(e) => onUpdateTitle(path, e.target.value)}
              placeholder="Enter chapter title..."
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold leading-5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">~{section.estimatedWords || 500}w</span>
            <button
              onClick={() => onRemove(path)}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/30 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover/section:opacity-100"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {section.children && section.children.length > 0 && (
            <ul className="border-t bg-slate-50/50 px-3 py-2">
              {section.children.map((child, ci) => (
                <DisplayOutlineNode
                  key={ci}
                  section={child}
                  path={[...path, ci]}
                  depth={depth + 1}
                  isDraggable={false}
                  dragIndex={dragIndex}
                  setDragIndex={setDragIndex}
                  onReorder={onReorder}
                  onUpdateTitle={onUpdateTitle}
                  onRemove={onRemove}
                  onInsertChild={onInsertChild}
                  onAddChild={onAddChild}
                  onInsertAfter={onInsertAfter}
                />
              ))}
              <li className="py-1">
                <button
                  onClick={() => onAddChild(path)}
                  className="flex cursor-pointer items-center gap-1 pl-4 text-[11px] font-medium text-primary/40 transition hover:text-primary/70"
                >
                  <Plus className="h-3 w-3" /> Add sub-section
                </button>
              </li>
            </ul>
          )}
          {(!section.children || section.children.length === 0) && (
            <div className="border-t bg-slate-50/50 px-3 py-1.5">
              <button
                onClick={() => onAddChild(path)}
                className="flex cursor-pointer items-center gap-1 pl-4 text-[11px] font-medium text-primary/40 transition hover:text-primary/70"
              >
                <Plus className="h-3 w-3" /> Add sub-section
              </button>
            </div>
          )}
        </li>
      );
    }

    return (
      <>
        <li
          className="group/child relative flex items-center gap-2 rounded-lg py-1.5 pl-4"
        >
          <span className={`shrink-0 text-xs font-semibold ${depth === 1 ? "text-primary/70" : "text-primary/50"}`}>
            {section.num}
          </span>
          <input
            value={section.title}
            onChange={(e) => onUpdateTitle(path, e.target.value)}
            placeholder="Enter title..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <span className="shrink-0 text-[10px] text-muted-foreground">~{section.estimatedWords || 300}w</span>
          <button
            onClick={() => onInsertAfter(path)}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-primary/0 transition hover:bg-primary-50 hover:text-primary group-hover/child:text-primary/40"
            title="Insert after"
          >
            <Plus className="h-2.5 w-2.5" />
          </button>
          <button
            onClick={() => onRemove(path)}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/0 transition hover:bg-red-50 hover:text-red-500 group-hover/child:text-muted-foreground/30"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </li>
        {section.children && section.children.length > 0 && (
          <ul className="pl-4">
            {section.children.map((child, ci) => (
              <DisplayOutlineNode
                key={ci}
                section={child}
                path={[...path, ci]}
                depth={depth + 1}
                isDraggable={false}
                dragIndex={dragIndex}
                setDragIndex={setDragIndex}
                onReorder={onReorder}
                onUpdateTitle={onUpdateTitle}
                onRemove={onRemove}
                onInsertChild={onInsertChild}
                onAddChild={onAddChild}
                onInsertAfter={onInsertAfter}
              />
            ))}
            <li className="py-0.5">
              <button
                onClick={() => onAddChild(path)}
                className="flex cursor-pointer items-center gap-1 pl-4 text-[10px] font-medium text-primary/30 transition hover:text-primary/60"
              >
                <Plus className="h-2.5 w-2.5" /> Add sub-section
              </button>
            </li>
          </ul>
        )}
        {!section.children?.length && (
          <div className="pl-8 py-0.5 opacity-0 transition-opacity group-hover/child:opacity-100">
            <button
              onClick={() => onAddChild(path)}
              className="flex cursor-pointer items-center gap-1 text-[10px] font-medium text-primary/30 transition hover:text-primary/60"
            >
              <Plus className="h-2.5 w-2.5" /> Add sub-section
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header title="Mind Organization" />

      <div className="h-[calc(100vh-64px)] overflow-hidden bg-slate-50/50 px-6 py-6 xl:px-8">
        <div className="mx-auto flex h-full max-w-[1600px] gap-6">
          {/* Session History */}
          <section className="hidden w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:flex">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
              <h4 className="font-display text-sm font-bold text-foreground">Sessions</h4>
              <button
                onClick={createSession}
                className="inline-flex cursor-pointer items-center gap-1 rounded-[12px] bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-primary-light"
              >
                <Plus className="h-3 w-3" />
                New
              </button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { if (renamingId !== s.id) loadSession(s.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); startRenaming(s); }}
                  className={`group w-full cursor-pointer rounded-[16px] border bg-white px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${
                    s.id === activeId ? "border-primary/60 bg-primary-50/60 shadow-md" : "border-border/60"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.status === "complete" ? "#16a34a" : "#a78bfa" }} />
                    <div className="min-w-0 flex-1">
                      {renamingId === s.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(s.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded border border-primary-300 bg-white px-2 py-0.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{s.title}</p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span>{new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                          <span className="text-border">·</span>
                          <span>{s._count?.messages || 0} msgs</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/40 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {sessions.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                  <Sparkles className="mb-3 h-8 w-8 opacity-25" />
                  <span className="text-xs leading-5">No brainstorming sessions yet.<br />Start one to begin.</span>
                </div>
              )}
            </div>
          </section>

          {/* Conversation */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
              <div className="flex min-w-0 items-center gap-3">
                <MessageSquare className="h-5 w-5 shrink-0 text-primary" />
                <h3 className="truncate font-display text-base font-bold text-foreground">
                  {activeSession?.title || "Document Brainstorming"}
                </h3>
              </div>
              {activeSession && (
                <div className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-emerald-600">
                  <span className="h-2 w-2 animate-task-pulse rounded-full bg-emerald-600" />
                  {displayStatus}
                </div>
              )}
            </div>

            <div className="custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto bg-slate-50 p-6">
              {!activeSession && (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary">
                    <Sparkles className="h-8 w-8" />
                  </div>
                  <h2 className="mb-2 font-display text-xl font-bold text-foreground">Document Brainstorming</h2>
                  <p className="mb-7 max-w-md text-sm leading-6 text-muted-foreground">
                    Collaborate with the AI Document Architect to structure your thoughts and generate a comprehensive document outline.
                  </p>
                  <button
                    onClick={createSession}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-light"
                  >
                    <Plus className="h-4 w-4" /> Start New Session
                  </button>
                </div>
              )}

              {activeSession && messages.length === 0 && !loading && (
                <>
                  <div className="self-center rounded-full border border-border bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">
                    New brainstorming session started · Socratic Skill active
                  </div>
                  <div className="flex max-w-[85%] self-start">
                    <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="rounded-[16px] rounded-tl bg-white px-4.5 py-3.5 text-sm leading-6 text-foreground shadow-sm ring-1 ring-border">
                        Tell me what kind of document you want to write. I will ask focused questions and turn the discussion into an outline.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isSystem = msg.role === "system";

                if (isSystem) {
                  return (
                    <div key={msg.id} className="self-center rounded-full border border-border bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">
                      {msg.content}
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`flex max-w-[85%] ${isUser ? "self-end flex-row-reverse" : "self-start"}`}>
                    <div className={`mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      isUser ? "bg-muted text-muted-foreground" : "bg-primary-100 text-primary"
                    }`}>
                      {isUser ? <User className="h-4 w-4" /> : <Bot className="h-5 w-5" />}
                    </div>
                    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                      <div className={`px-4.5 py-3.5 text-sm leading-6 shadow-sm ${
                        isUser
                          ? "rounded-[16px] rounded-tr bg-primary text-white"
                          : "rounded-[16px] rounded-tl bg-white text-foreground ring-1 ring-border"
                      }`}>
                        {isUser ? msg.content : renderAIContent(msg.content)}
                      </div>
                      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">{formatTime(msg.createdAt)}</div>
                    </div>
                  </div>
                );
              })}

              {loading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex max-w-[85%] self-start">
                  <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2 rounded-[16px] rounded-tl bg-white px-5 py-4 shadow-sm ring-1 ring-border">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.2s" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              )}
              <div ref={messagesEnd} />
            </div>

            <div className="bg-slate-50/50 px-6 pb-6 pt-3 shrink-0">
              <div className="flex min-h-[52px] items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10">
                <label
                  className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 ${!activeSession || loading ? "pointer-events-none opacity-40" : ""}`}
                  title="Upload Document"
                >
                  <Paperclip className="h-4.5 w-4.5" />
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={!activeSession || loading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <textarea
                  rows={1}
                  placeholder="Answer the AI or refine the outline..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  disabled={!activeSession}
                  className="min-h-9 max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-foreground placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim() || !activeSession}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary-600 text-white transition hover:bg-primary-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  title="Send"
                >
                  <Send className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          </section>

          {/* Right Panel */}
          <section className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:flex">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
              <div className="flex items-center gap-2 font-display text-base font-bold text-foreground">
                <LayoutList className="h-[18px] w-[18px]" />
                Outline
              </div>
              {outline && (
                <span className="font-sans text-xs font-semibold text-muted-foreground">
                  ~{totalWords().toLocaleString()} words
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col overflow-hidden p-6">
              {outline ? (
                <>
                  {editing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="mb-4 w-full border-b-2 border-primary-100 bg-transparent pb-3 text-[15px] font-bold text-foreground focus:border-primary focus:outline-none"
                    />
                  ) : (
                    <div className="mb-4 border-b-2 border-primary-100 pb-3 text-[15px] font-bold text-foreground">
                      {outline.title}
                    </div>
                  )}

                  <div className="custom-scrollbar flex-1 overflow-y-auto">
                    {editing ? (
                      <div className="space-y-3">
                        {editSections.map((s, i) => (
                          <EditOutlineNode
                            key={i}
                            section={s}
                            path={[i]}
                            onUpdate={updateEditNode}
                            onRemove={removeEditNode}
                            onAddChild={addEditChild}
                            depth={0}
                          />
                        ))}
                        <button
                          onClick={addEditSection}
                          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-200 py-2.5 text-xs font-semibold text-primary hover:bg-primary-50"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Section
                        </button>
                      </div>
                    ) : (
                      <>
                      <ul className="space-y-2">
                        {outline.sections.map((s, i) => (
                          <DisplayOutlineNode
                            key={i}
                            section={s}
                            path={[i]}
                            depth={0}
                            isDraggable={true}
                            dragIndex={dragIndex}
                            setDragIndex={setDragIndex}
                            onReorder={reorderSections}
                            onUpdateTitle={updateNodeTitle}
                            onRemove={removeNode}
                            onInsertChild={insertChildAfter}
                            onAddChild={(parentPath) => {
                              if (!outline) return;
                              const updated = addChildAtPath(outline.sections, parentPath, { num: "", title: "", estimatedWords: 200 });
                              const newOutline = { ...outline, sections: renumberSections(updated) };
                              setOutline(newOutline);
                              persistOutline(newOutline);
                            }}
                            onInsertAfter={(path) => {
                              if (!outline) return;
                              const parentPath = path.slice(0, -1);
                              const myIndex = path[path.length - 1];
                              const updated = addChildAtPath(outline.sections, [...parentPath, myIndex], { num: "", title: "", estimatedWords: 200 });
                              const newOutline = { ...outline, sections: renumberSections(updated) };
                              setOutline(newOutline);
                              persistOutline(newOutline);
                            }}
                          />
                        ))}
                      </ul>
                      <button
                        onClick={() => insertSectionAfter(outline.sections.length - 1)}
                        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-[12px] border border-dashed border-primary/20 py-2 text-xs font-medium text-primary/60 transition hover:border-primary/40 hover:bg-primary-50/50 hover:text-primary"
                      >
                        <Plus className="h-3 w-3" /> Add Chapter
                      </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-4 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary">
                    <LayoutList className="h-7 w-7" />
                  </div>
                  <h4 className="mb-2 font-semibold text-foreground">Outline Preview</h4>
                  <p className="mb-6 max-w-[250px] text-sm leading-6 text-muted-foreground">
                    Discuss your requirements with the AI, and an outline will appear here.
                  </p>
                  <button
                    onClick={generateOutline}
                    disabled={loading || messages.length < 2 || !activeSession}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sparkles className="h-4 w-4" /> Generate Manually
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-50/50 px-6 py-5 border-t border-slate-200 shrink-0">
              {editing ? (
                <div className="flex gap-3">
                  <button
                    onClick={saveEditing}
                    className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 text-[13px] font-semibold text-white transition hover:bg-primary-700 shadow-sm"
                  >
                    <Check className="h-4 w-4" /> Save
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm"
                  >
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button
                      onClick={startEditing}
                      disabled={!outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                    >
                      <Edit3 className="h-4 w-4" /> Edit
                    </button>
                    <button
                      onClick={clearOutline}
                      disabled={loading || !outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Regenerate
                    </button>
                  </div>
                  <button
                    onClick={confirmAndWrite}
                    disabled={confirming || !outline}
                    className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-[14px] font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                  >
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {confirming ? "Preparing..." : "Confirm & Write"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background-color: #94a3b8;
        }
      `}} />
    </div>
  );
}
