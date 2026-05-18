"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function usePolling(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options?: { enabled?: boolean },
) {
  const [active, setActive] = useState(options?.enabled ?? false);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  const start = useCallback(() => setActive(true), []);
  const stop = useCallback(() => setActive(false), []);

  return { active, start, stop };
}
