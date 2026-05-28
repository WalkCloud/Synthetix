"use client";

import { useState, useCallback, useRef } from "react";

interface AssetGenState {
  status: "idle" | "generating" | "success" | "error";
  progress: string;
  assetId: string | null;
  url: string | null;
  error: string | null;
}

interface AssetGenOptions {
  draftId: string;
  sectionId: string;
}

export function useAssetGen({ draftId, sectionId }: AssetGenOptions) {
  const [imageState, setImageState] = useState<AssetGenState>({
    status: "idle", progress: "", assetId: null, url: null, error: null,
  });
  const [diagramState, setDiagramState] = useState<AssetGenState>({
    status: "idle", progress: "", assetId: null, url: null, error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const generateImage = useCallback(async (params: {
    markerId: string;
    prompt: string;
    title?: string;
    size?: string;
    style?: string;
  }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setImageState({ status: "generating", progress: "调用 API...", assetId: null, url: null, error: null });

    try {
      const baseUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/generate-image`;
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error(err.error || "图片生成失败");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应流");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setImageState(s => ({ ...s, progress: data.message || data.stage || "处理中..." }));
            } else if (data.type === "complete") {
              setImageState({ status: "success", progress: "完成", assetId: data.assetId, url: data.url, error: null });
            } else if (data.type === "error") {
              setImageState({ status: "error", progress: "", assetId: null, url: null, error: data.error || "生成失败" });
            }
          } catch {}
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setImageState({ status: "error", progress: "", assetId: null, url: null, error: err instanceof Error ? err.message : "未知错误" });
    }
  }, [draftId, sectionId]);

  const generateDiagram = useCallback(async (params: {
    markerId: string;
    type: string;
    title: string;
    style?: string;
    nodes: Array<{ label: string; shape?: string; icon?: string; componentType?: string }>;
    arrows: Array<{ from: string; to: string; label?: string; flow?: string }>;
    containers?: Array<{ label: string; nodeIds: string[]; containerType?: string }>;
    summaryCards?: Array<{ title: string; color: string; items: string[] }>;
  }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setDiagramState({ status: "generating", progress: "构建规格...", assetId: null, url: null, error: null });

    try {
      const baseUrl = `/api/v1/drafts/${draftId}/sections/${sectionId}/assets/generate-diagram`;
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "请求失败" }));
        throw new Error(err.error || "图表生成失败");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应流");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setDiagramState(s => ({ ...s, progress: data.message || data.stage || "处理中..." }));
            } else if (data.type === "complete") {
              setDiagramState({ status: "success", progress: "完成", assetId: data.assetId, url: data.url, error: null });
            } else if (data.type === "error") {
              setDiagramState({ status: "error", progress: "", assetId: null, url: null, error: data.error || "生成失败" });
            }
          } catch {}
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setDiagramState({ status: "error", progress: "", assetId: null, url: null, error: err instanceof Error ? err.message : "未知错误" });
    }
  }, [draftId, sectionId]);

  const confirmAsset = useCallback(async (markerId: string, assetId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/v1/drafts/${draftId}/sections/${sectionId}/assets/confirm-asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markerId, assetId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.content || null;
    } catch {
      return null;
    }
  }, [draftId, sectionId]);

  const reset = useCallback(() => {
    setImageState({ status: "idle", progress: "", assetId: null, url: null, error: null });
    setDiagramState({ status: "idle", progress: "", assetId: null, url: null, error: null });
  }, []);

  return { imageState, diagramState, generateImage, generateDiagram, confirmAsset, reset };
}
