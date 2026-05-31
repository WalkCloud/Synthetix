import { useState, useEffect, useCallback } from "react";
import type { BrainstormSession, BrainstormMessage, BrainstormOutline, Phase } from "./types";

export function useBrainstormSessions() {
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
      setStatus(d.data.status === "active" ? "Active" : "Complete");
      if (parsedOutline) {
        setPhase("ready");
      } else {
        setPhase("gathering");
        const taskRes = await fetch(`/api/v1/tasks?type=outline_generate&status=pending,running`).catch(() => null);
        if (taskRes) {
          const taskData = await taskRes.json().catch(() => null);
          if (taskData?.success && taskData.data?.length > 0) {
            const activeTask = taskData.data.find((t: { sessionId: string | null }) => t.sessionId === id);
            if (activeTask) {
              setOutlineTaskId(activeTask.id);
              setPhase("ready");
            }
          }
        }
      }
    }
    setLoading(false);
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
        setPhase("gathering");
      }
    }
  }

  return {
    sessions, setSessions, activeId, messages, setMessages,
    outline, setOutline, status, setStatus, phase, setPhase,
    loading, setLoading, outlineTaskId,
    loadSession, createSession, deleteSession,
  };
}
