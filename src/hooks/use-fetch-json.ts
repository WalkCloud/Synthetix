"use client";

import { useState, useCallback, useRef } from "react";

interface FetchJsonResult<T = unknown> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useFetchJson<T = unknown>() {
  const [state, setState] = useState<FetchJsonResult<T>>({ data: null, error: null, loading: false });
  const controllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (url: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(url, { signal: controller.signal, ...options });
      const json = await res.json();
      if (json.success) {
        setState({ data: json.data as T, error: null, loading: false });
        return { success: true, data: json.data as T };
      }
      const errMsg = json.error || "Request failed";
      setState((s) => ({ ...s, loading: false, error: errMsg }));
      return { success: false, error: errMsg };
    } catch (err) {
      if ((err as Error).name === "AbortError") return { success: false };
      const errMsg = err instanceof Error ? err.message : "Request failed";
      setState((s) => ({ ...s, loading: false, error: errMsg }));
      return { success: false, error: errMsg };
    }
  }, []);

  return { ...state, execute };
}
