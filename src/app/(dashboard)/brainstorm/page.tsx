"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";

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
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((d) => { if (d.success) setSessions(d.data); }); }, []);

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
      if (d.data.outlineRequested) generateOutline();
      // Refresh sessions list for message count
      fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
    }
    setLoading(false);
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function generateOutline() {
    if (!activeId) return;
    setLoading(true);
    const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/generate-outline`, { method: "POST" });
    const d = await res.json();
    if (d.success) { setOutline(d.data); setStatus("Complete"); }
    setLoading(false);
  }

  function totalWords(): number {
    return outline?.sections.reduce((sum, s) => sum + (s.estimatedWords || 0), 0) || 0;
  }

  function getPhase(): string {
    const userMsgs = messages.filter((m) => m.role === "user").length;
    if (userMsgs <= 1) return "Understanding Phase";
    if (userMsgs <= 3) return "Clarifying Phase";
    if (outline) return "Structuring Phase";
    return "Deepening Phase";
  }

  function formatTime(d: string): string {
    return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function formatDate(d: string): string {
    const dt = new Date(d);
    const now = new Date();
    if (dt.toDateString() === now.toDateString()) return "Today";
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (dt.toDateString() === yesterday.toDateString()) return "Yesterday";
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div>
      <Header title="Mind Organization" />
      <div className="p-8 pt-4">
        <div className="grid grid-cols-[220px_1fr_320px] gap-0 h-[calc(100vh-var(--header-height)-96px)]">
          {/* Left: Session History */}
          <div className="bg-white border-r border-[#E4E4E7] flex flex-col overflow-hidden rounded-l-[16px]">
            <div className="p-4 border-b border-[#E4E4E7] flex items-center justify-between">
              <h4 className="text-[13px] font-semibold text-foreground">Sessions</h4>
              <button onClick={createSession} className="w-6 h-6 flex items-center justify-center bg-transparent border-none cursor-pointer rounded-lg hover:bg-[#EEEEE9] text-muted-foreground transition-colors" title="New Session">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sessions.map((s) => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                  className={`p-2.5 px-3 rounded-[12px] cursor-pointer mb-0.5 transition-colors hover:bg-[#F5F6FE] ${s.id === activeId ? "bg-[#F5F6FE] border-l-[3px] border-primary" : ""}`}>
                  <div className="text-[13px] font-semibold text-foreground truncate">{s.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s._count?.messages || 0} messages · {formatDate(s.updatedAt)}</div>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="p-4 text-center text-xs text-muted-foreground">No sessions yet. Click + to start.</div>
              )}
            </div>
          </div>

          {/* Center: Conversation */}
          <div className="flex flex-col overflow-hidden">
            {activeSession ? (
              <>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E4E4E7] bg-white">
                  <div className="flex items-center gap-2.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-primary"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <h3 className="text-[15px] font-semibold text-foreground">{activeSession.title}</h3>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[#16A34A] font-medium">
                    <span className="w-[7px] h-[7px] rounded-full bg-[#16A34A] animate-pulse" />{getPhase()}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 bg-[#F5F5F3]">
                  {messages.map((msg) => {
                    if (msg.role === "system") return (
                      <div key={msg.id} className="flex justify-center">
                        <div className="bg-white border border-[#E4E4E7] text-muted-foreground text-xs text-center rounded-full px-[18px] py-1.5">{msg.content}</div>
                      </div>
                    );
                    if (msg.role === "user") return (
                      <div key={msg.id} className="flex justify-end max-w-[85%] self-end">
                        <div>
                          <div className="bg-[#EEF0FD] text-foreground border border-[#DDE2FC] rounded-[16px] rounded-br-[4px] px-4 py-3 text-sm leading-relaxed">{msg.content}</div>
                          <div className="text-[11px] text-muted-foreground mt-1 text-right">{formatTime(msg.createdAt)}</div>
                        </div>
                      </div>
                    );
                    return (
                      <div key={msg.id} className="flex max-w-[85%] self-start gap-2.5">
                        <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 bg-[#EEF0FD] text-primary">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m8.66-14.5l-5.2 3m-5 2.9l-5.2 3M22.66 17.5l-5.2-3m-5-2.9l-5.2-3"/></svg>
                        </div>
                        <div>
                          <div className="bg-white border border-[#E4E4E7] text-foreground rounded-[16px] rounded-bl-[4px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                          <div className="text-[11px] text-muted-foreground mt-1">{formatTime(msg.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {loading && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex max-w-[85%] self-start gap-2.5">
                      <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 bg-[#EEF0FD] text-primary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="3"/></svg>
                      </div>
                      <div className="bg-white border border-[#E4E4E7] rounded-[16px] rounded-bl-[4px] px-4 py-3 text-sm text-muted-foreground">Thinking...</div>
                    </div>
                  )}
                  <div ref={messagesEnd} />
                </div>
                <div className="p-3.5 px-5 border-t border-[#E4E4E7] bg-white">
                  <div className="flex items-end gap-2">
                    <textarea rows={1} placeholder="Share your thoughts..." value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      className="flex-1 px-3.5 py-2.5 border border-[#E4E4E7] rounded-[16px] text-sm font-sans resize-none min-h-[42px] max-h-[100px] bg-white text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 transition-all" />
                    <button onClick={sendMessage} disabled={loading || !input.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light disabled:opacity-40 transition-all text-sm cursor-pointer">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-[#F5F5F3]">
                <div className="text-center text-muted-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3 opacity-40"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <p className="text-sm">Select a session or create a new one to start brainstorming</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Outline Panel */}
          <div className="bg-white border-l border-[#E4E4E7] flex flex-col overflow-y-auto rounded-r-[16px]">
            <div className="p-4 border-b border-[#E4E4E7]">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.5px] text-muted-foreground">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Outline
                </span>
                {outline && <span className="text-[11px] text-muted-foreground">~{totalWords().toLocaleString()} words</span>}
              </div>
              {outline ? (
                <div className="text-sm font-bold text-foreground pb-2 border-b-2 border-primary/15">{outline.title}</div>
              ) : (
                <div className="text-sm text-muted-foreground pb-2 border-b-2 border-primary/15">No outline yet. Start a conversation and generate one.</div>
              )}
            </div>
            {outline ? (
              <div className="flex flex-col flex-1">
                <ul className="list-none p-0 flex-1 overflow-y-auto">
                  {outline.sections.map((s, i) => (
                    <li key={i} className="mb-0.5">
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[12px] cursor-pointer hover:bg-[#F5F6FE] text-xs transition-colors">
                        <span className="font-bold text-primary min-w-[20px]">{s.num}.</span>
                        <span className="font-semibold text-foreground flex-1">{s.title}</span>
                        <span className="text-[11px] text-muted-foreground">~{s.estimatedWords || 500}w</span>
                        {i < 3 && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-[#16A34A] shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="p-3 border-t border-[#E4E4E7] flex gap-1.5">
                  <button className="flex-1 justify-center text-xs px-3 py-2 bg-white text-foreground border border-[#E4E4E7] rounded-xl font-medium hover:bg-[#EEEEE9] transition-colors cursor-pointer">Edit</button>
                  <button onClick={generateOutline} className="flex-1 justify-center text-xs px-3 py-2 bg-transparent text-muted-foreground rounded-xl font-medium hover:bg-[#EEEEE9] transition-colors cursor-pointer border-none">Regenerate</button>
                  <button className="flex-1 justify-center text-xs px-3 py-2 bg-[#FF6B3D] text-white rounded-xl font-medium hover:bg-[#FF8A63] transition-colors cursor-pointer border-none">Confirm & Write</button>
                </div>
              </div>
            ) : (
              activeSession && (
                <div className="p-4 flex-1 flex items-center justify-center">
                  <button onClick={generateOutline} disabled={loading}
                    className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-light disabled:opacity-40 transition-all cursor-pointer">
                    Generate Outline
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
