"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Typewriter effect hook — progressively reveals `target` text with a
 * requestAnimationFrame-driven easing animation.
 *
 * Extracted from editor-panel.tsx where the same algorithm was duplicated
 * three times (single generation, compare A, compare B) with different
 * variable names (design §4.7).
 *
 * Behaviour:
 * - When `active` is false or `target` is empty, display resets to "".
 * - When `active` is true, display animates toward `target` in steps of
 *   `Math.max(1, Math.ceil((target.length - prev.length) / 8))` per frame.
 * - Cancels the animation frame on cleanup to prevent leaks.
 *
 * @param active  Whether the typewriter should be running.
 * @param target  The full text to progressively reveal.
 * @returns The currently displayed (partially revealed) text.
 */
export function useTypewriter(input: {
  active: boolean;
  target: string;
}): string {
  const { active, target } = input;
  const [displayed, setDisplayed] = useState("");
  const typingRef = useRef<number | null>(null);
  const targetRef = useRef("");

  useEffect(() => {
    if (!active || !target) {
      targetRef.current = "";
      setDisplayed("");
      if (typingRef.current) {
        cancelAnimationFrame(typingRef.current);
        typingRef.current = null;
      }
      return;
    }

    targetRef.current = target;

    if (typingRef.current) return;

    const tick = () => {
      setDisplayed((prev) => {
        const tgt = targetRef.current;
        if (prev.length >= tgt.length) {
          typingRef.current = null;
          return prev;
        }
        const step = Math.max(1, Math.ceil((tgt.length - prev.length) / 8));
        return tgt.slice(0, Math.min(prev.length + step, tgt.length));
      });
      typingRef.current = requestAnimationFrame(tick);
    };
    typingRef.current = requestAnimationFrame(tick);

    return () => {
      if (typingRef.current) {
        cancelAnimationFrame(typingRef.current);
        typingRef.current = null;
      }
    };
  }, [active, target]);

  return displayed;
}
