import { useState, useCallback } from "react";
import type { BrainstormClientMarker, BrainstormMessage, BrainstormSession, Phase } from "./types";
import { getLocalizedError, useLocale } from "@/lib/i18n";
import { SUPPORTED_FORMATS, BRAINSTORM_MAX_UPLOAD_BYTES } from "@/types/documents";

function newClientMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface UseBrainstormChatOptions {
  activeId: string | null;
  phase: Phase;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<BrainstormMessage[]>>;
  setSessions: React.Dispatch<React.SetStateAction<BrainstormSession[]>>;
  handleMarker: (marker: string) => void;
  scrollToEnd: () => void;
}

function inferModeSelectClientMarker(content: string, phase: Phase): BrainstormClientMarker | undefined {
  if (phase !== "mode_select" && phase !== "ready_to_generate") return undefined;
  const text = content.trim();
  if (phase === "ready_to_generate") {
    if (/^(生成|开始生成|生成完整大纲|generate|A)(?:[\s,，.。:：]|$)/i.test(text)) {
      return "GENERATE_DIRECT";
    }
    return undefined;
  }
  if (/^A(?:[\s,，.。:：]|$)/i.test(text) || text.startsWith("直接生成完整大纲")) {
    return "GENERATE_DIRECT";
  }
  if (/^B(?:[\s,，.。:：]|$)/i.test(text) || text.startsWith("逐节细化")) {
    return "SECTION_BY_SECTION";
  }
  return undefined;
}

export function useBrainstormChat({
  activeId, phase, loading, setLoading, setMessages, setSessions,
  handleMarker, scrollToEnd,
}: UseBrainstormChatOptions) {
  const { locale, t, format } = useLocale();
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const optimisticUser = useCallback((content: string): BrainstormMessage => {
    return { id: newClientMessageId("opt"), sessionId: activeId!, role: "user", content, createdAt: new Date().toISOString() };
  }, [activeId]);

  const systemMsg = useCallback((text: string): BrainstormMessage => {
    return { id: newClientMessageId("err"), sessionId: activeId!, role: "system", content: text, createdAt: new Date().toISOString() };
  }, [activeId]);

  const postMessage = useCallback(async (content: string, optimisticId?: string, clientMarker?: BrainstormClientMarker) => {
    if (!activeId || isSending) return;
    setLoading(true); setIsSending(true);

    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-locale": locale },
        body: JSON.stringify({ content, clientMarker, phase }),
      });
      const d = await res.json();
      if (d.success) {
        setMessages((prev) => {
          const mapped = optimisticId
            ? prev.map((m) => m.id === optimisticId ? d.data.userMessage : m)
            : prev;
          return d.data.message ? [...mapped, d.data.message] : mapped;
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
        setMessages((prev) => [...prev, systemMsg(`${t.brainstorm.errorPrefix}: ${getLocalizedError(d) || t.brainstorm.unknownError}`)]);
        setIsSending(false); setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev, systemMsg(t.brainstorm.networkError)]);
      setIsSending(false); setLoading(false);
    }
    scrollToEnd();
  }, [
    activeId,
    handleMarker,
    isSending,
    locale,
    phase,
    scrollToEnd,
    setLoading,
    setMessages,
    setSessions,
    systemMsg,
    t.brainstorm.errorPrefix,
    t.brainstorm.networkError,
    t.brainstorm.unknownError,
  ]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !activeId || isSending) return;
    const content = input; setInput("");
    const optId = newClientMessageId("opt");
    setMessages((prev) => [...prev, optimisticUser(content)]);
    scrollToEnd();
    await postMessage(content, optId, inferModeSelectClientMarker(content, phase));
  }, [activeId, input, isSending, optimisticUser, phase, postMessage, scrollToEnd, setMessages]);

  const sendQuickMessage = useCallback(async (content: string, clientMarker?: BrainstormClientMarker) => {
    if (!activeId || isSending) return;
    setInput("");
    const optId = newClientMessageId("opt-q");
    setMessages((prev) => [...prev, { ...optimisticUser(content), id: optId }]);
    scrollToEnd();
    await postMessage(content, optId, clientMarker);
  }, [activeId, isSending, optimisticUser, postMessage, scrollToEnd, setMessages]);

  async function handleFileUpload(file: File) {
    if (!activeId || loading) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
      setMessages((prev) => [...prev, systemMsg(t.brainstorm.upload.unsupportedFormat)]);
      return;
    }
    if (file.size > BRAINSTORM_MAX_UPLOAD_BYTES) {
      setMessages((prev) => [...prev, systemMsg(t.brainstorm.upload.fileTooLarge)]);
      return;
    }

    setLoading(true);
    const optId = newClientMessageId("opt-sys");
    setMessages((prev) => [...prev, { id: optId, sessionId: activeId, role: "system", content: format.template(t.brainstorm.uploadStatus, { fileName: file.name }), createdAt: new Date().toISOString() }]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/v1/brainstorm/sessions/${activeId}/upload`, { method: "POST", headers: { "x-locale": locale }, body: formData });
      const d = await res.json();
      if (d.success) {
        const aiRes = await fetch(`/api/v1/brainstorm/sessions/${activeId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-locale": locale },
          body: JSON.stringify({ content: t.brainstorm.uploadPrompt, phase }),
        });
        const aiData = await aiRes.json();
        if (aiData.success && aiData.data.marker) {
          handleMarker(aiData.data.marker);
        }
        fetch("/api/v1/brainstorm/sessions").then((r) => r.json()).then((sd) => { if (sd.success) setSessions(sd.data); });
      } else {
        setMessages((prev) => [...prev.filter((m) => m.id !== optId), systemMsg(`${t.brainstorm.uploadFailed} ${d.error || ""}`.trim())]);
        setLoading(false);
      }
    } catch {
      setMessages((prev) => [...prev.filter((m) => m.id !== optId), systemMsg(t.brainstorm.uploadFailed)]);
      setLoading(false);
    }
  }

  return { input, setInput, isSending, sendMessage, sendQuickMessage, handleFileUpload };
}
