"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Header } from "@/components/layout/header";
import { renderAIContent } from "@/components/shared/markdown-renderer";
import { useBrainstormSessions } from "@/hooks/brainstorm/use-brainstorm-sessions";
import { useBrainstormChat } from "@/hooks/brainstorm/use-brainstorm-chat";
import { useBrainstormOutline } from "@/hooks/brainstorm/use-brainstorm-outline";
import { EditOutlineNode } from "@/components/brainstorm/edit-outline-node";
import { DisplayOutlineNode } from "@/components/brainstorm/display-outline-node";
import { useLocale } from "@/lib/i18n";
import {
  MessageSquare, LayoutList, Plus, Send, RefreshCw,
  Bot, User, Edit3, Loader2, Sparkles, Paperclip,
  Trash2, Check, X, FileText
} from "lucide-react";

export default function BrainstormPage() {
  const { locale, t, format } = useLocale();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);
  const sess = useBrainstormSessions();

  const scrollToEnd = useCallback(() => {
    setTimeout(() => messagesEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  const outline = useBrainstormOutline({
    activeId: sess.activeId,
    outline: sess.outline,
    setOutline: sess.setOutline,
    setStatus: sess.setStatus,
    setPhase: sess.setPhase,
    loading: sess.loading,
    setLoading: sess.setLoading,
    setSessions: sess.setSessions,
    setOutlineTaskId: sess.setOutlineTaskId,
  });
  const { generateOutline, startPollingExternal } = outline;

  useEffect(() => {
    if (sess.outlineTaskId) {
      startPollingExternal(sess.outlineTaskId);
    }
  }, [startPollingExternal, sess.outlineTaskId]);

  const handleMarker = useCallback((marker: string) => {
    switch (marker) {
      case "NEEDS_GATHERED": sess.setPhase("direction"); sess.setLoading(false); break;
      case "DIRECTION_CONFIRMED": sess.setPhase("mode_select"); sess.setLoading(false); break;
      case "GENERATE_DIRECT": sess.setPhase("ready"); generateOutline(); break;
      case "SECTION_BY_SECTION": sess.setPhase("section_refine"); sess.setLoading(false); break;
      case "ALL_SECTIONS_CONFIRMED": sess.setPhase("ready"); generateOutline(); break;
      default: sess.setLoading(false); break;
    }
  }, [generateOutline, sess]);

  const chat = useBrainstormChat({
    activeId: sess.activeId,
    phase: sess.phase,
    loading: sess.loading,
    setLoading: sess.setLoading,
    setMessages: sess.setMessages,
    setSessions: sess.setSessions,
    handleMarker,
    scrollToEnd,
  });

  const activeSession = sess.sessions.find((s) => s.id === sess.activeId);
  const displayStatus = sess.outline
    ? t.brainstorm.outlineGenerated
    : sess.phase === "gathering"
      ? t.brainstorm.phases.exploration
      : sess.phase === "direction"
        ? t.brainstorm.phases.structuring
        : sess.phase === "mode_select"
          ? t.brainstorm.phases.structuring
          : sess.phase === "section_refine"
            ? t.brainstorm.phases.refinement
            : t.brainstorm.outlineGenerated;

  function formatTime(d: string): string {
    return new Date(d).toLocaleTimeString(locale === "zh-CN" ? "zh-CN" : "en-US", { hour: "numeric", minute: "2-digit" });
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
      <Header title={t.brainstorm.title} />

      <div className="h-[calc(100vh-64px)] overflow-hidden bg-muted/40 px-6 py-6 dark:bg-background xl:px-8">
        <div className="mx-auto flex h-full max-w-[1600px] gap-6">
          {/* Session History */}
          <section className="hidden w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-soft xl:flex">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-5">
              <h4 className="font-display text-sm font-bold text-foreground">{t.brainstorm.sessionListTitle}</h4>
              <button onClick={sess.createSession} className="inline-flex cursor-pointer items-center gap-1 rounded-[12px] bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-primary-light">
                <Plus className="h-3 w-3" /> {t.brainstorm.newSession}
              </button>
            </div>
            <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto bg-muted/50 p-4 dark:bg-background/35">
              {sess.sessions.map((s) => (
                <div key={s.id}
                  onClick={() => { if (renamingId !== s.id) sess.loadSession(s.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); startRenaming(s); }}
                  className={`group w-full cursor-pointer rounded-[16px] border bg-card px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md dark:shadow-none dark:hover:bg-primary/10 ${s.id === sess.activeId ? "border-primary/60 bg-primary-50/60 shadow-md dark:border-primary/55 dark:bg-primary/15 dark:ring-1 dark:ring-primary/20" : "border-border/60 dark:border-border"}`}
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
                          className="w-full rounded border border-primary-300 bg-card px-2 py-0.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{s.title}</p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span>{format.date(s.updatedAt)}</span>
                          <span className="text-border">·</span>
                          <span>{s._count?.messages || 0} {t.brainstorm.messageCount}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); sess.deleteSession(s.id); }}
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/40 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title={t.common.actions.delete}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {sess.sessions.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground dark:text-muted-foreground">
                  <Sparkles className="mb-3 h-8 w-8 opacity-40 dark:text-primary" />
                  <span className="text-xs leading-5">{t.brainstorm.emptySessions}<br/>{t.brainstorm.emptySessionsDesc}</span>
                </div>
              )}
            </div>
          </section>

          {/* Conversation */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-soft">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
              <div className="flex min-w-0 items-center gap-3">
                <MessageSquare className="h-5 w-5 shrink-0 text-primary" />
                <h3 className="truncate font-display text-base font-bold text-foreground dark:text-card-foreground">{activeSession?.title || t.brainstorm.title}</h3>
              </div>
              {activeSession && (
                <div className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-emerald-600">
                  <span className="h-2 w-2 animate-task-pulse rounded-full bg-emerald-600" />
                  {displayStatus}
                </div>
              )}
            </div>

            <div className="custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto bg-muted/50 p-6 dark:bg-background/35">
              {!activeSession && (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15 dark:text-primary"><Sparkles className="h-8 w-8" /></div>
                  <h2 className="mb-2 font-display text-xl font-bold text-foreground dark:text-card-foreground">{t.brainstorm.title}</h2>
                  <p className="mb-7 max-w-md text-sm leading-6 text-muted-foreground">{t.brainstorm.startConversationDesc}</p>
                  <button onClick={sess.createSession} className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-light">
                    <Plus className="h-4 w-4" /> {t.brainstorm.startConversation}
                  </button>
                </div>
              )}

              {activeSession && sess.messages.length === 0 && !sess.loading && (
                <>
                  <div className="self-center rounded-full border border-border bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">
                    {t.brainstorm.sessionStarted}
                  </div>
                  <div className="flex max-w-[85%] self-start">
                    <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15"><Bot className="h-5 w-5" /></div>
                    <div>
                      <div className="rounded-[16px] rounded-tl bg-card px-4.5 py-3.5 text-sm leading-6 text-foreground shadow-sm ring-1 ring-border">
                        {t.brainstorm.initialAssistantMessage}
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
                    <div className={`mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isUser ? "bg-muted text-muted-foreground dark:bg-secondary dark:text-foreground" : "bg-primary-100 text-primary dark:bg-primary/15"}`}>
                      {isUser ? <User className="h-4 w-4" /> : <Bot className="h-5 w-5" />}
                    </div>
                    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                      <div className={`px-4.5 py-3.5 text-sm leading-6 shadow-sm ${isUser ? "rounded-[16px] rounded-tr bg-primary text-white" : "rounded-[16px] rounded-tl bg-card text-foreground ring-1 ring-border"}`}>
                        {isUser ? msg.content : renderAIContent(msg.content)}
                      </div>
                      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">{formatTime(msg.createdAt)}</div>
                    </div>
                  </div>
                );
              })}

              {chat.isSending && sess.messages[sess.messages.length - 1]?.role === "user" && (
                <div className="flex max-w-[85%] self-start">
                  <div className="mx-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15"><Bot className="h-5 w-5" /></div>
                  <div className="flex items-center gap-2 rounded-[16px] rounded-tl bg-card px-5 py-4 shadow-sm ring-1 ring-border">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.2s" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              )}

              {sess.phase === "mode_select" && !chat.isSending && (
                <div className="flex max-w-[85%] self-start gap-3 ml-12">
                  <button onClick={() => chat.sendQuickMessage(t.brainstorm.quickActions.directMessage, "GENERATE_DIRECT")}
                    className="flex-1 cursor-pointer rounded-2xl border-2 border-primary-200 bg-card p-4 text-left shadow-sm transition hover:border-primary hover:bg-primary-50 dark:border-primary/35 dark:hover:border-primary/65 dark:hover:bg-primary/12">
                    <div className="text-sm font-bold text-foreground">{t.brainstorm.quickActions.directTitle}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t.brainstorm.quickActions.directDesc}</div>
                  </button>
                  <button onClick={() => chat.sendQuickMessage(t.brainstorm.quickActions.refineMessage, "SECTION_BY_SECTION")}
                    className="flex-1 cursor-pointer rounded-2xl border-2 border-primary-200 bg-card p-4 text-left shadow-sm transition hover:border-primary hover:bg-primary-50 dark:border-primary/35 dark:hover:border-primary/65 dark:hover:bg-primary/12">
                    <div className="text-sm font-bold text-foreground">{t.brainstorm.quickActions.refineTitle}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t.brainstorm.quickActions.refineDesc}</div>
                  </button>
                </div>
              )}

              {sess.phase === "section_refine" && !sess.loading && !sess.outline && (
                <div className="self-center rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-center text-xs font-semibold text-primary dark:border-primary/35 dark:bg-primary/15">
                  {t.brainstorm.outlinePanel.sectionRefineBanner}
                </div>
              )}
              <div ref={messagesEnd} />
            </div>

            <div className="bg-muted/40 px-6 pb-6 pt-3 shrink-0 dark:bg-background/35">
              <div className="flex min-h-[52px] items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm transition-all focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10 dark:shadow-none">
                <label className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-muted-foreground ${!sess.activeId || chat.isSending ? "pointer-events-none opacity-40" : ""}`} title={t.documents.upload.title}>
                  <Paperclip className="h-4.5 w-4.5" />
                  <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md" className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={!sess.activeId || chat.isSending}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) chat.handleFileUpload(file); e.target.value = ""; }}
                  />
                </label>
                <textarea rows={1} placeholder={t.brainstorm.placeholder} value={chat.input}
                  onChange={(e) => chat.setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chat.sendMessage(); } }}
                  disabled={!sess.activeId}
                  className="min-h-9 max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button onClick={chat.sendMessage} disabled={chat.isSending || !chat.input.trim() || !sess.activeId}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary-600 text-white transition hover:bg-primary-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40" title={t.brainstorm.send}>
                  <Send className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          </section>

          {/* Right Panel */}
          <section className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-soft xl:flex">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
              <div className="flex items-center gap-2 font-display text-base font-bold text-foreground"><LayoutList className="h-[18px] w-[18px]" /> {t.writing.outline}</div>
              {sess.outline && <span className="font-sans text-xs font-semibold text-muted-foreground">~{outline.totalWords().toLocaleString()} {t.brainstorm.wordUnit}</span>}
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
                        <button onClick={outline.addEditSection} className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-200 py-2.5 text-xs font-semibold text-primary hover:bg-primary-50 dark:border-primary/35 dark:hover:bg-primary/12">
                          <Plus className="h-3.5 w-3.5" /> {t.brainstorm.addSection}
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
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-b from-primary/10 to-card p-4 dark:border-primary/25 dark:from-primary/15 dark:to-card">
                  <div className="mb-4 flex shrink-0 items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm ring-1 ring-primary-100 dark:ring-primary/25">
                      <Sparkles className="h-5 w-5 animate-pulse" />
                      <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">{t.brainstorm.outlinePanel.generatingTitle}</h4>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.brainstorm.outlinePanel.generatingDesc}</p>
                    </div>
                  </div>
                  <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {t.brainstorm.outlinePanel.generationSteps.map((item, idx) => (
                      <div key={item} className="rounded-xl border border-card/80 bg-card/80 p-2.5 shadow-sm">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary dark:bg-primary/15">{idx + 1}</span>
                          <span className="text-xs font-semibold text-foreground/75 dark:text-foreground">{item}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full w-1/2 rounded-full bg-primary-500 animate-loading-bar" style={{ animationDelay: `${idx * 0.18}s` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : sess.phase === "mode_select" ? (
                <div className="flex flex-1 flex-col items-center justify-center bg-muted/50 px-4 text-center dark:bg-background/35">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15"><Sparkles className="h-7 w-7" /></div>
                  <h4 className="mb-2 font-semibold text-foreground">{t.brainstorm.outlinePanel.modeSelectTitle}</h4>
                  <p className="max-w-[240px] text-sm leading-6 text-muted-foreground">{t.brainstorm.outlinePanel.modeSelectDesc}</p>
                </div>
              ) : sess.phase === "section_refine" ? (
                <div className="flex flex-1 flex-col items-center justify-center bg-muted/50 px-4 text-center dark:bg-background/35">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15"><MessageSquare className="h-7 w-7" /></div>
                  <h4 className="mb-2 font-semibold text-foreground">{t.brainstorm.outlinePanel.refiningTitle}</h4>
                  <p className="max-w-[240px] text-sm leading-6 text-muted-foreground">{t.brainstorm.outlinePanel.refiningDesc}</p>
                </div>
              ) : sess.phase === "ready" ? (
                <div className="flex flex-1 flex-col items-center justify-center bg-muted/50 px-4 text-center dark:bg-background/35">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"><RefreshCw className="h-7 w-7" /></div>
                  <h4 className="mb-2 font-semibold text-foreground">{t.brainstorm.outlinePanel.generationFailedTitle}</h4>
                  <p className="mb-4 max-w-[240px] text-sm leading-6 text-muted-foreground">{outline.outlineError || t.brainstorm.outlinePanel.generationFailedDesc}</p>
                  <button onClick={outline.generateOutline} disabled={sess.loading}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground/75 shadow-sm transition hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-foreground dark:shadow-none">
                    <RefreshCw className="h-4 w-4" /> {t.common.actions.retry}
                  </button>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center bg-muted/50 px-4 text-center dark:bg-background/35">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary dark:bg-primary/15"><LayoutList className="h-7 w-7" /></div>
                  <h4 className="mb-2 font-semibold text-foreground">{t.brainstorm.outlinePanel.previewTitle}</h4>
                  <p className="max-w-[250px] text-sm leading-6 text-muted-foreground">{t.brainstorm.outlinePanel.previewDesc}</p>
                </div>
              )}
            </div>

            <div className="bg-muted/40 px-6 py-5 border-t border-border shrink-0 dark:bg-background/35">
              {outline.editing ? (
                <div className="flex gap-3">
                  <button onClick={outline.saveEditing} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 text-[13px] font-semibold text-white transition hover:bg-primary-700 shadow-sm">
                    <Check className="h-4 w-4" /> {t.common.actions.save}
                  </button>
                  <button onClick={outline.cancelEditing} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold text-foreground/75 transition hover:bg-secondary/70 shadow-sm dark:text-foreground dark:shadow-none">
                    <X className="h-4 w-4" /> {t.common.actions.cancel}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button onClick={outline.startEditing} disabled={!sess.outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold text-foreground/75 transition hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm dark:text-foreground dark:shadow-none">
                      <Edit3 className="h-4 w-4" /> {t.common.actions.edit}
                    </button>
                    <button onClick={outline.regenerateOutline} disabled={sess.loading || !sess.outline}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[13px] font-semibold text-foreground/75 transition hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm dark:text-foreground dark:shadow-none">
                      {sess.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t.writing.sections.regenerate}
                    </button>
                  </div>
                  <button onClick={outline.confirmAndWrite} disabled={outline.confirming || !sess.outline}
                    className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-[14px] font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm">
                    {outline.confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {outline.confirming ? t.common.states.processing + "..." : t.brainstorm.generateOutline}
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
