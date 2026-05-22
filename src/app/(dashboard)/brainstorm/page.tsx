"use client";

import { useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { renderAIContent } from "@/components/shared/markdown-renderer";
import { useBrainstormSessions } from "@/hooks/brainstorm/use-brainstorm-sessions";
import { useBrainstormChat } from "@/hooks/brainstorm/use-brainstorm-chat";
import { useBrainstormOutline } from "@/hooks/brainstorm/use-brainstorm-outline";
import { EditOutlineNode } from "@/components/brainstorm/edit-outline-node";
import { DisplayOutlineNode } from "@/components/brainstorm/display-outline-node";
import type { BrainstormMessage, Phase } from "@/hooks/brainstorm/types";
import {
  MessageSquare, LayoutList, Plus, Send, RefreshCw,
  Bot, User, Edit3, Loader2, Sparkles, Paperclip,
  Trash2, Check, X, FileText
} from "lucide-react";

const phaseLabels: Record<Phase, string> = {
  gathering: "需求深挖中",
  direction: "选择大纲方向",
  mode_select: "选择生成模式",
  section_refine: "逐章精炼中",
  ready: "大纲已就绪",
};

export default function BrainstormPage() {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const sess = useBrainstormSessions();

  const scrollToEnd = useCallback(() => {
    setTimeout(() => sess.messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  const outline = useBrainstormOutline({
    activeId: sess.activeId,
    outline: sess.outline,
    setOutline: sess.setOutline,
    setStatus: sess.setStatus,
    setPhase: sess.setPhase,
    loading: sess.loading,
    setLoading: sess.setLoading,
    setSessions: sess.setSessions as any,
    scrollToEnd,
  });

  const handleMarker = useCallback((marker: string) => {
    switch (marker) {
      case "NEEDS_GATHERED": sess.setPhase("direction"); sess.setLoading(false); break;
      case "DIRECTION_CONFIRMED": sess.setPhase("mode_select"); sess.setLoading(false); break;
      case "GENERATE_DIRECT": sess.setPhase("ready"); outline.generateOutline(); break;
      case "SECTION_BY_SECTION": sess.setPhase("section_refine"); sess.setLoading(false); break;
      case "ALL_SECTIONS_CONFIRMED": sess.setPhase("ready"); outline.generateOutline(); break;
      default: sess.setLoading(false); break;
    }
  }, [outline.generateOutline, sess.setPhase, sess.setLoading]);

  const chat = useBrainstormChat({
    activeId: sess.activeId,
    loading: sess.loading,
    setLoading: sess.setLoading,
    setMessages: sess.setMessages,
    setSessions: sess.setSessions as any,
    setPhase: sess.setPhase,
    handleMarker,
    scrollToEnd,
  });

  const activeSession = sess.sessions.find((s) => s.id === sess.activeId);
  const displayStatus = sess.outline
    ? "Outline Ready"
    : sess.phase === "gathering"
      ? "Deepening Phase"
      : phaseLabels[sess.phase];

  function formatTime(d: string): string {
    return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function startRenaming(s: typeof sess.sessions[number]) {
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
      sess.setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: trimmed } : s));
    }
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
              <button onClick={sess.createSession} className="inline-flex cursor-pointer items-center gap-1 rounded-[12px] bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-primary-light">
                <Plus className="h-3 w-3" /> New
              </button>
            </div>
            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
              {sess.sessions.map((s) => (
                <div key={s.id}
                  onClick={() => { if (renamingId !== s.id) sess.loadSession(s.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); startRenaming(s); }}
                  className={`group w-full cursor-pointer rounded-[16px] border bg-white px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${s.id === sess.activeId ? "border-primary/60 bg-primary-50/60 shadow-md" : "border-border/60"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.status === "complete" ? "#16a34a" : "#a78bfa" }} />
                    <div className="min-w-0 flex-1">
                      {renamingId === s.id ? (
                        <input autoFocus value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") commitRename(s.id); if (e.key === "Escape") setRenamingId(null); }}
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
                        <button onClick={(e) => { e.stopPropagation(); sess.deleteSession(s.id); }}
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/40 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {sess.sessions.length === 0 && (
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
                <h3 className="truncate font-display text-base font-bold text-foreground">{activeSession?.title || "Document Brainstorming"}</h3>
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
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary"><Sparkles className="h-8 w-8" /></div>
                  <h2 className="mb-2 font-display text-xl font-bold text-foreground">Document Brainstorming</h2>
                  <p className="mb-7 max-w-md text-sm leading-6 text-muted-foreground">Collaborate with the AI Document Architect to structure your thoughts and generate a comprehensive document outline.</p>
                  <button onClick={sess.createSession} className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-light">
                    <Plus className="h-4 w-4" /> Start New Session
                  </button>
                </div>
              )}

              {activeSession && sess.messages.length === 0 && !sess.loading && (
                <>
                  <div className="self-center rounded-full border border-border bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">New brainstorming session started · Socratic Skill active</div>
                  <div className="flex max-w-[85%] self-start">
                    <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary"><Bot className="h-5 w-5" /></div>
                    <div>
                      <div className="rounded-[16px] rounded-tl bg-white px-4.5 py-3.5 text-sm leading-6 text-foreground shadow-sm ring-1 ring-border">
                        Tell me what kind of document you want to write. I will ask focused questions step by step, then help you build a structured outline.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {sess.messages.map((msg) => {
                const isUser = msg.role === "user";
                if (msg.role === "system") {
                  return <div key={msg.id} className="self-center rounded-full border border-border bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">{msg.content}</div>;
                }
                return (
                  <div key={msg.id} className={`flex max-w-[85%] ${isUser ? "self-end flex-row-reverse" : "self-start"}`}>
                    <div className={`mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isUser ? "bg-muted text-muted-foreground" : "bg-primary-100 text-primary"}`}>
                      {isUser ? <User className="h-4 w-4" /> : <Bot className="h-5 w-5" />}
                    </div>
                    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                      <div className={`px-4.5 py-3.5 text-sm leading-6 shadow-sm ${isUser ? "rounded-[16px] rounded-tr bg-primary text-white" : "rounded-[16px] rounded-tl bg-white text-foreground ring-1 ring-border"}`}>
                        {isUser ? msg.content : renderAIContent(msg.content)}
                      </div>
                      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">{formatTime(msg.createdAt)}</div>
                    </div>
                  </div>
                );
              })}

              {chat.isSending && sess.messages[sess.messages.length - 1]?.role === "user" && (
                <div className="flex max-w-[85%] self-start">
                  <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary"><Bot className="h-5 w-5" /></div>
                  <div className="flex items-center gap-2 rounded-[16px] rounded-tl bg-white px-5 py-4 shadow-sm ring-1 ring-border">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.2s" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              )}

              {sess.phase === "mode_select" && !chat.isSending && (
                <div className="flex max-w-[85%] self-start gap-3 ml-12">
                  <button onClick={() => chat.sendQuickMessage("A，请直接生成完整大纲，可以直接开始写作。")}
                    className="flex-1 rounded-2xl border-2 border-primary-200 bg-white p-4 text-left shadow-sm hover:border-primary hover:bg-primary-50 transition cursor-pointer">
                    <div className="text-sm font-bold text-foreground">A) 直接生成</div>
                    <div className="mt-1 text-xs text-muted-foreground">一次性生成完整大纲，直接进入写作</div>
                  </button>
                  <button onClick={() => chat.sendQuickMessage("B，我想逐章讨论，确保每个章节都精准覆盖想要的内容。")}
                    className="flex-1 rounded-2xl border-2 border-primary-200 bg-white p-4 text-left shadow-sm hover:border-primary hover:bg-primary-50 transition cursor-pointer">
                    <div className="text-sm font-bold text-foreground">B) 逐章精炼</div>
                    <div className="mt-1 text-xs text-muted-foreground">逐个讨论每章内容后再生成大纲</div>
                  </button>
                </div>
              )}

              {sess.phase === "section_refine" && !sess.loading && !sess.outline && (
                <div className="self-center rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-center text-xs text-primary font-semibold">
                  逐章精炼模式 · 请逐一回答 AI 关于每个章节的问题
                </div>
              )}
              <div ref={sess.messagesEnd} />
            </div>

            <div className="bg-slate-50/50 px-6 pb-6 pt-3 shrink-0">
              <div className="flex min-h-[52px] items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10">
                <label className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 ${!sess.activeId || chat.isSending ? "pointer-events-none opacity-40" : ""}`} title="Upload Document">
                  <Paperclip className="h-4.5 w-4.5" />
                  <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md" className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={!sess.activeId || chat.isSending}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) chat.handleFileUpload(file); e.target.value = ""; }}
                  />
                </label>
                <textarea rows={1} placeholder="Answer the AI or refine the outline..." value={chat.input}
                  onChange={(e) => chat.setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chat.sendMessage(); } }}
                  disabled={!sess.activeId}
                  className="min-h-9 max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-foreground placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button onClick={chat.sendMessage} disabled={chat.isSending || !chat.input.trim() || !sess.activeId}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary-600 text-white transition hover:bg-primary-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40" title="Send">
                  <Send className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          </section>

          {/* Right Panel */}
          <section className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:flex">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
              <div className="flex items-center gap-2 font-display text-base font-bold text-foreground"><LayoutList className="h-[18px] w-[18px]" /> Outline</div>
              {sess.outline && <span className="font-sans text-xs font-semibold text-muted-foreground">~{outline.totalWords().toLocaleString()} words</span>}
            </div>
            <div className="flex flex-1 flex-col overflow-hidden p-6">
              {sess.outline ? (
                <>
                  {outline.editing ? (
                    <input type="text" value={outline.editTitle} onChange={(e) => outline.setEditTitle(e.target.value)}
                      className="mb-4 w-full border-b-2 border-primary-100 bg-transparent pb-3 text-[15px] font-bold text-foreground focus:border-primary focus:outline-none" />
                  ) : (
                    <div className="mb-4 border-b-2 border-primary-100 pb-3 text-[15px] font-bold text-foreground">{sess.outline.title}</div>
                  )}
                  <div className="custom-scrollbar flex-1 overflow-y-auto">
                    {outline.editing ? (
                      <div className="space-y-3">
                        {outline.editSections.map((s, i) => (
                          <EditOutlineNode key={i} section={s} path={[i]} onUpdate={outline.updateEditNode} onRemove={outline.removeEditNode} onAddChild={outline.addEditChild} depth={0} />
                        ))}
                        <button onClick={outline.addEditSection} className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-200 py-2.5 text-xs font-semibold text-primary hover:bg-primary-50">
                          <Plus className="h-3.5 w-3.5" /> Add Section
                        </button>
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {sess.outline.sections.map((s, i) => (
                          <DisplayOutlineNode key={i} section={s} path={[i]} depth={0} />
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : outline.isGeneratingOutline ? (
                <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-b from-primary-50/70 to-white p-5">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-primary-100">
                      <Sparkles className="h-5 w-5 animate-pulse" />
                      <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Generating outline</h4>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Structuring chapters, drafting hidden writing requirements, and preparing retrieval cues.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {["Reading confirmed requirements", "Arranging chapter hierarchy", "Writing section-level instructions", "Preparing knowledge-base search cues"].map((item, idx) => (
                      <div key={item} className="rounded-xl border border-white/80 bg-white/80 p-3 shadow-sm">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary">{idx + 1}</span>
                          <span className="text-xs font-semibold text-slate-700">{item}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full w-1/2 rounded-full bg-primary-500 animate-loading-bar" style={{ animationDelay: `${idx * 0.18}s` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto rounded-xl border border-primary-100 bg-white/70 p-3 text-xs leading-5 text-muted-foreground">
                    This step may take longer because each section receives drafting guidance that will be used later for full-document generation.
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-4 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary"><LayoutList className="h-7 w-7" /></div>
                  <h4 className="mb-2 font-semibold text-foreground">Outline Preview</h4>
                  <p className="mb-6 max-w-[250px] text-sm leading-6 text-muted-foreground">Discuss your requirements with the AI, and an outline will appear here.</p>
                  <button onClick={outline.generateOutline} disabled={sess.loading || sess.messages.length < 2 || !activeSession}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary shadow-sm transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <Sparkles className="h-4 w-4" /> Generate Manually
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-50/50 px-6 py-5 border-t border-slate-200 shrink-0">
              {outline.editing ? (
                <div className="flex gap-3">
                  <button onClick={outline.saveEditing} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 text-[13px] font-semibold text-white transition hover:bg-primary-700 shadow-sm">
                    <Check className="h-4 w-4" /> Save
                  </button>
                  <button onClick={outline.cancelEditing} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 shadow-sm">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button onClick={outline.startEditing} disabled={!sess.outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm">
                      <Edit3 className="h-4 w-4" /> Edit
                    </button>
                    <button onClick={outline.clearOutline} disabled={sess.loading || !sess.outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm">
                      {sess.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regenerate
                    </button>
                  </div>
                  <button onClick={outline.confirmAndWrite} disabled={outline.confirming || !sess.outline}
                    className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-[14px] font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm">
                    {outline.confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {outline.confirming ? "Preparing..." : "Confirm & Write"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: #94a3b8; }
      `}} />
    </div>
  );
}
