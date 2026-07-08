import { useState, useEffect, useCallback } from "react";
import type { BrainstormSession, BrainstormMessage, BrainstormOutline, Phase } from "./types";
import { inferSessionPhase, type OutlineTaskLike } from "@/lib/brainstorm/session-phase";
import { useLocale } from "@/lib/i18n";

export function useBrainstormSessions() {
  const { locale, t } = useLocale();
  const [sessions, setSessions] = useState<BrainstormSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [outline, setOutline] = useState<BrainstormOutline | null>(null);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<Phase>("gathering");
  const [loading, setLoading] = useState(false);
  const [outlineTaskId, setOutlineTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/brainstorm/sessions")
      .then((r) => r.json())
      .then((d) => { if (d.success) setSessions(d.data); });
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setActiveId(id); setLoading(true);
    setOutlineTaskId(null);
    const res = await fetch(`/api/v1/brainstorm/sessions/${id}`);
    const d = await res.json();
    if (d.success) {
      setMessages(d.data.messages || []);
      const parsedOutline = d.data.outline ? JSON.parse(d.data.outline) : null;
      setOutline(parsedOutline);
      setStatus(d.data.status === "active" ? t.brainstorm.status.active : t.brainstorm.status.complete);
      if (parsedOutline) {
        setPhase("ready");
      } else {
        // No outline yet. Phase is not persisted server-side, so re-derive it
        // from the session's outline_generate tasks. We fetch pending/running
        // AND failed in one go: an active task means "polling" (ready), while a
        // failed task (with no active one) means "generation failed, show the
        // retry panel" — also ready, which renders page.tsx's failed/retry UI.
        // Without the failed branch, a session whose outline task timed out
        // would be stuck at "gathering" with no way to regenerate.
        const taskRes = await fetch(`/api/v1/tasks?type=outline_generate&status=pending,running,failed`).catch(() => null);
        let sessionTasks: OutlineTaskLike[] = [];
        if (taskRes) {
          const taskData = await taskRes.json().catch(() => null);
          if (taskData?.success && Array.isArray(taskData.data)) {
            sessionTasks = taskData.data.filter((t: OutlineTaskLike) => t.sessionId === id);
          }
        }
        const activeTask = sessionTasks.find(
          (t) => t.status === "pending" || t.status === "running",
        );
        if (activeTask?.id) {
          // Only resume polling for tasks that can still progress; a failed
          // task has nothing to poll.
          setOutlineTaskId(activeTask.id);
        }
        setPhase(inferSessionPhase(false, sessionTasks, id));
      }
    }
    setLoading(false);
  }, [t.brainstorm.status.active, t.brainstorm.status.complete]);

  async function createSession() {
    const res = await fetch("/api/v1/brainstorm/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-locale": locale },
      body: JSON.stringify({ title: t.brainstorm.defaultSessionTitle, locale }),
    });
    const d = await res.json();
    if (d.success) {
      setSessions((prev) => [d.data, ...prev]);
      loadSession(d.data.id);
    }
  }

  async function deleteSession(id: string) {
    if (!window.confirm(t.brainstorm.deleteSessionConfirm)) return;
    const res = await fetch(`/api/v1/brainstorm/sessions/${id}`, { method: "DELETE" });
    const d = await res.json();
    if (d.success) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setOutline(null);
        setStatus("");
        setPhase("gathering");
      }
    }
  }

  return {
    sessions, setSessions, activeId, messages, setMessages,
    outline, setOutline, status, setStatus, phase, setPhase,
    loading, setLoading, outlineTaskId, setOutlineTaskId,
    loadSession, createSession, deleteSession,
  };
}
