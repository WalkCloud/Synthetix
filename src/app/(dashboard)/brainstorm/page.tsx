"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import {
  MessageSquare, LayoutList, Plus, Send, RefreshCw, CheckCircle2,
  ChevronRight, Bot, User, Edit3, ArrowRight, Loader2, Sparkles, FileText,
  Trash2, Check, X, GripVertical
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

interface OutlineSection {
  num: string;
  title: string;
  keyPoints?: string[];
  estimatedWords?: number;
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
  const [editSections, setEditSections] = useState<OutlineSection[]>([]);
  const [editTitle, setEditTitle] = useState("");
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
    if (!activeId || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST" });
      const d = await res.json();
      if (d.success) { setOutline(d.data); setStatus("Complete"); }
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
    return outline?.sections.reduce((sum, s) => sum + (s.estimatedWords || 0), 0) || 0;
  }

  function formatTime(d: string): string {
    return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function renderAIContent(content: string): React.ReactNode {
    const text = content.replace(/OUTLINE_REQUESTED/g, "").trim();
    if (!text) return null;

    const lines = text.split("\n");
    return lines.map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const renderedLine = parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={j} className="text-indigo-900 font-semibold">{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      const isList = /^[-*]\s|^[0-9]+[.．]\s/.test(line.trim());
      if (isList) {
        return (
          <div key={i} className="pl-4 relative my-1 text-slate-700">
            <span className="absolute left-0 top-[8px] w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
            {renderedLine}
          </div>
        );
      }
      return <span key={i} className="block mb-2 text-slate-700 leading-relaxed">{renderedLine}</span>;
    });
  }

  const activeSession = sessions.find((s) => s.id === activeId);

  function startEditing() {
    if (!outline) return;
    setEditTitle(outline.title);
    setEditSections(outline.sections.map((s) => ({ ...s })));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditSections([]);
    setEditTitle("");
  }

  function saveEditing() {
    if (!outline) return;
    const renumbered = editSections.map((s, i) => ({
      ...s,
      num: String(i + 1),
    }));
    setOutline({ ...outline, title: editTitle, sections: renumbered });
    setEditing(false);
  }

  function updateEditSection(index: number, field: "title" | "estimatedWords", value: string) {
    setEditSections((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        if (field === "estimatedWords") {
          return { ...s, estimatedWords: parseInt(value) || 0 };
        }
        return { ...s, [field]: value };
      }),
    );
  }

  function removeEditSection(index: number) {
    setEditSections((prev) => prev.filter((_, i) => i !== index));
  }

  function addEditSection() {
    setEditSections((prev) => [
      ...prev,
      { num: String(prev.length + 1), title: "", estimatedWords: 500 },
    ]);
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50/50">
      <Header title="Brainstorm & Outline" />

      <div className="flex-1 overflow-hidden p-6 gap-6 grid grid-cols-[260px_minmax(0,1fr)] max-w-[1600px] mx-auto w-full h-[calc(100vh-var(--header-height))]">

        {/* Left Sidebar: Sessions */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 flex flex-col overflow-hidden backdrop-blur-xl">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white/50">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              <h4 className="text-sm font-semibold text-slate-800">Sessions</h4>
            </div>
            <button
              onClick={createSession}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
              title="New Session"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                className={`p-3 rounded-xl cursor-pointer transition-all duration-200 group ${
                  s.id === activeId
                    ? "bg-indigo-50/80 border border-indigo-100/50 shadow-sm"
                    : "hover:bg-slate-50 border border-transparent"
                }`}
              >
                <div className={`text-sm font-medium truncate mb-1 ${s.id === activeId ? "text-indigo-900" : "text-slate-700 group-hover:text-slate-900"}`}>
                  {s.title}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{s._count?.messages || 0}</span>
                  <span>{new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="p-8 text-center flex flex-col items-center justify-center text-slate-400">
                <Sparkles className="w-8 h-8 mb-3 opacity-20" />
                <span className="text-xs">No brainstorming sessions yet.<br/>Start one to begin.</span>
              </div>
            )}
          </div>
        </div>

        {/* Main Dual-Pane Workspace */}
        {activeSession ? (
          <div className="flex gap-6 overflow-hidden">

            {/* Left Pane: Chat */}
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200/60 flex flex-col relative overflow-hidden backdrop-blur-xl">
              <div className="px-6 py-4 border-b border-slate-100 bg-white/80 backdrop-blur-md flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{activeSession.title}</h3>
                    <p className="text-[11px] text-slate-500 font-medium">AI Document Architect</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-slate-50/30 custom-scrollbar">
                {messages.length === 0 && !loading && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50">
                     <Bot className="w-16 h-16 text-indigo-300 mb-4" />
                     <p className="text-sm text-slate-500 max-w-[250px]">Hello! I am your Document Architect. Tell me what kind of document you want to write, and I will draft an outline for you immediately.</p>
                  </div>
                )}

                {messages.map((msg) => {
                  if (msg.role === "system") return null;

                  const isUser = msg.role === "user";
                  return (
                    <div key={msg.id} className={`flex gap-4 max-w-[88%] ${isUser ? "self-end flex-row-reverse" : "self-start"}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                        isUser ? "bg-slate-800 text-white" : "bg-gradient-to-br from-indigo-500 to-purple-600 text-white"
                      }`}>
                        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                      </div>
                      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                        <div className={`px-5 py-3.5 shadow-sm text-[14px] leading-relaxed ${
                          isUser
                            ? "bg-slate-800 text-white rounded-[20px] rounded-tr-[4px]"
                            : "bg-white border border-slate-100 text-slate-700 rounded-[20px] rounded-tl-[4px]"
                        }`}>
                          {isUser ? msg.content : renderAIContent(msg.content)}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1.5 px-2">{formatTime(msg.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}

                {loading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex gap-4 max-w-[85%] self-start">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white border border-slate-100 rounded-[20px] rounded-tl-[4px] px-5 py-4 shadow-sm flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                    </div>
                  </div>
                )}
                <div ref={messagesEnd} />
              </div>

              <div className="p-4 bg-white border-t border-slate-100">
                <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-[20px] shadow-inner focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                  <textarea
                    rows={1}
                    placeholder="Describe your document idea or request changes to the outline..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    className="flex-1 bg-transparent px-5 py-3.5 text-[14px] resize-none min-h-[52px] max-h-[120px] text-slate-700 placeholder:text-slate-400 focus:outline-none custom-scrollbar"
                  />
                  <div className="pr-2">
                    <button
                      onClick={sendMessage}
                      disabled={loading || !input.trim()}
                      className="w-10 h-10 flex items-center justify-center bg-indigo-600 text-white rounded-full hover:bg-indigo-700 hover:shadow-md disabled:opacity-40 disabled:hover:shadow-none transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4 ml-0.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Pane: Outline */}
            <div className="w-[400px] flex flex-col shrink-0">
              <div className="flex-1 bg-gradient-to-b from-indigo-50/50 to-white rounded-2xl shadow-sm border border-indigo-100/60 flex flex-col overflow-hidden relative">

                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-400/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

                <div className="p-5 border-b border-indigo-100/50 relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                      <LayoutList className="w-4 h-4" /> Document Outline
                    </span>
                    {outline && (
                      <span className="text-[11px] font-semibold bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
                        ~{totalWords().toLocaleString()} words
                      </span>
                    )}
                  </div>
                  {outline ? (
                    <div className="text-base font-bold text-slate-800 leading-tight">{outline.title}</div>
                  ) : (
                    <div className="text-sm text-slate-400 italic">No outline generated yet.</div>
                  )}
                </div>

                {outline ? (
                  <div className="flex flex-col flex-1 relative z-10 overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                      {editing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full text-base font-bold text-slate-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          {editSections.map((s, i) => (
                            <div key={i} className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-xl">
                              <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />
                              <span className="text-[11px] font-bold text-indigo-600 w-5 text-center shrink-0">{i + 1}</span>
                              <input
                                type="text"
                                value={s.title}
                                onChange={(e) => updateEditSection(i, "title", e.target.value)}
                                placeholder="Section title..."
                                className="flex-1 text-[13px] font-medium text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-400 focus:outline-none py-1 px-1 transition-colors"
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                value={s.estimatedWords || ""}
                                onChange={(e) => updateEditSection(i, "estimatedWords", e.target.value)}
                                className="w-16 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-300 shrink-0"
                                placeholder="words"
                              />
                              <button
                                onClick={() => removeEditSection(i)}
                                className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={addEditSection}
                            className="w-full flex items-center justify-center gap-1.5 text-[12px] text-indigo-600 border border-dashed border-indigo-200 rounded-xl py-2.5 hover:bg-indigo-50 transition-colors cursor-pointer mt-1"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Section
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {outline.sections.map((s, i) => (
                            <div key={i} className="group flex items-start gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer">
                              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 font-bold text-[11px] shrink-0 mt-0.5">
                                {s.num}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="text-[13px] font-semibold text-slate-800 mb-1 leading-snug">{s.title}</h5>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                  <span>~{s.estimatedWords || 500} words</span>
                                  {i < 3 && <span className="flex items-center text-emerald-500"><CheckCircle2 className="w-3 h-3 mr-0.5" /> Ready</span>}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-1" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-4 bg-white/80 backdrop-blur-md border-t border-indigo-100/50 flex flex-col gap-2">
                      {editing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={saveEditing}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors cursor-pointer shadow-sm"
                          >
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-semibold hover:border-slate-300 transition-colors cursor-pointer shadow-sm"
                          >
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <button onClick={startEditing} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-4 py-2.5 bg-white text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl font-semibold transition-colors cursor-pointer shadow-sm">
                              <Edit3 className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button onClick={clearOutline} disabled={loading} className="flex-1 flex items-center justify-center gap-1.5 text-xs px-4 py-2.5 bg-white text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl font-semibold transition-colors cursor-pointer shadow-sm disabled:opacity-50">
                              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Reset
                            </button>
                          </div>
                          <button
                            onClick={confirmAndWrite}
                            disabled={confirming}
                            className="w-full flex items-center justify-center gap-2 text-[13px] px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg disabled:opacity-50 transition-all cursor-pointer"
                          >
                            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                            {confirming ? "Preparing Document..." : "Confirm & Start Writing"}
                            {!confirming && <ArrowRight className="w-4 h-4 ml-1" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative z-10">
                    <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4 text-indigo-300">
                      <LayoutList className="w-8 h-8" />
                    </div>
                    <h4 className="text-slate-800 font-semibold mb-2">Outline Preview</h4>
                    <p className="text-sm text-slate-500 mb-6 max-w-[250px]">Discuss your requirements with the AI, and an outline will appear here.</p>
                    <button
                      onClick={generateOutline}
                      disabled={loading || messages.length < 2}
                      className="px-5 py-2.5 bg-white border border-indigo-200 text-indigo-600 text-sm font-semibold rounded-full hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-40 disabled:hover:bg-white shadow-sm transition-all cursor-pointer flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" /> Generate Manually
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl shadow-sm border border-slate-200/60 backdrop-blur-xl">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
              <Sparkles className="w-10 h-10 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Document Brainstorming</h2>
            <p className="text-slate-500 text-center max-w-md mb-8 leading-relaxed">
              Collaborate with the AI Document Architect to structure your thoughts and generate a comprehensive document outline.
            </p>
            <button
              onClick={createSession}
              className="px-6 py-3 bg-indigo-600 text-white rounded-full font-semibold shadow-md hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-5 h-5" /> Start New Session
            </button>
          </div>
        )}
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
