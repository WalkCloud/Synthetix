import { useState, useCallback } from "react";
import type { BrainstormMessage, Phase } from "./types";

function newClientMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface UseBrainstormChatOptions {
  activeId: string | null;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<BrainstormMessage[]>>;
  setSessions: React.Dispatch<React.SetStateAction<{ id: string; title: string; _count?: { messages: number } }[]>>;
  setPhase: (p: Phase) => void;
  handleMarker: (marker: string) => void;
  scrollToEnd: () => void;
}

export function useBrainstormChat({
  activeId, loading, setLoading, setMessages, setSessions,
  setPhase, handleMarker, scrollToEnd,
}: UseBrainstormChatOptions) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  function optimisticUser(content: string): BrainstormMessage {
    return { id: newClientMessageId("opt"), sessionId: activeId!, role: "user", content, createdAt: new Date().toISOString() };
  }

  function systemMsg(text: string): BrainstormMessage {
    return { id: newClientMessageId("err"), sessionId: activeId!, role: "system", content: text, createdAt: new Date().toISOString() };
  }

  async function postMessage(content: string, optimisticId?: string) {
    if (!activeId || isSending) return;
    setLoading(true); setIsSending(true);

    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const d = await res.json();
      if (d.success) {
        setMessages((prev) => {
          const mapped = optimisticId
            ? prev.map((m) => m.id === optimisticId ? d.data.userMessage : m)
            : prev;
          return [...mapped, d.data.message];
        });
        setIsSending(false);
        const marker = d.data.marker;
        if (marker === "GENERATE_DIRECT" || marker === "ALL_SECTIONS_CONFIRMED") {
          handleMarker(marker);
        } else {
          setLoading(false);
          if (marker) handleMarker(marker);
        }
        fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
      } else {
        setMessages((prev) => [...prev, systemMsg(`Error: ${d.error || "Unknown error"}`)]);
        setIsSending(false); setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev, systemMsg("Network error, please try again.")]);
      setIsSending(false); setLoading(false);
    }
    scrollToEnd();
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !activeId || isSending) return;
    const content = input; setInput("");
    const optId = newClientMessageId("opt");
    setMessages((prev) => [...prev, optimisticUser(content)]);
    scrollToEnd();
    await postMessage(content, optId);
  }, [input, activeId, isSending]);

  const sendQuickMessage = useCallback(async (content: string) => {
    if (!activeId || isSending) return;
    setInput("");
    const optId = newClientMessageId("opt-q");
    setMessages((prev) => [...prev, { ...optimisticUser(content), id: optId }]);
    scrollToEnd();
    await postMessage(content, optId);
  }, [activeId, isSending]);

  async function handleFileUpload(file: File) {
    if (!activeId || loading) return;
    setLoading(true);
    const optId = newClientMessageId("opt-sys");
    setMessages((prev) => [...prev, { id: optId, sessionId: activeId, role: "system", content: `Uploading document "${file.name}" and extracting content...`, createdAt: new Date().toISOString() }]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/upload`, { method: "POST", body: formData });
      const d = await res.json();
      if (d.success) {
        const aiRes = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Please give me an outline suggestion based on the uploaded document." }),
        });
        const aiData = await aiRes.json();
        if (aiData.success && aiData.data.marker) {
          handleMarker(aiData.data.marker);
        }
        fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
      } else {
        setMessages((prev) => [...prev.filter((m) => m.id !== optId), systemMsg(`Upload failed: ${d.error}`)]);
        setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev.filter((m) => m.id !== optId), systemMsg("Upload failed, please try again.")]);
      setLoading(false);
    }
  }

  return { input, setInput, isSending, sendMessage, sendQuickMessage, handleFileUpload };
}
