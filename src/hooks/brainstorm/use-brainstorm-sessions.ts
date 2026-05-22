import { useState, useEffect, useCallback, useRef } from "react";
import type { BrainstormSession, BrainstormMessage, BrainstormOutline, Phase } from "./types";

export function useBrainstormSessions() {
  const [sessions, setSessions] = useState<BrainstormSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [outline, setOutline] = useState<BrainstormOutline | null>(null);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<Phase>("gathering");
  const [loading, setLoading] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

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
      const parsedOutline = d.data.outline ? JSON.parse(d.data.outline) : null;
      setOutline(parsedOutline);
      setStatus(d.data.status === "active" ? "Active" : "Complete");
      if (parsedOutline) {
        setPhase("ready");
      } else {
        setPhase("gathering");
      }
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
    loading, setLoading, messagesEnd,
    loadSession, createSession, deleteSession,
  };
}
