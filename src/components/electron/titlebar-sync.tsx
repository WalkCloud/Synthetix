"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Sync the Electron window's title bar overlay color with the current page
 * theme. On Windows (where titleBarOverlay is active), this makes the title
 * bar background match the page (light bg #F8FAFC / dark bg #0B0F19) instead
 * of the OS default. No-op in a plain browser (window.synthetix absent).
 *
 * The min/max/close buttons are drawn by Windows in symbolColor; we pick a
 * readable slate tone per theme.
 *
 * The `window.synthetix` global type is declared once in src/types/electron.d.ts
 * and shared by all renderer consumers (titlebar-sync, update-bridge, About).
 */

const TITLEBAR_COLORS = {
  light: { bg: "#F8FAFC", symbol: "#334155" }, // slate-50 bg, slate-700 symbols
  dark: { bg: "#0B0F19", symbol: "#94A3B8" }, // app dark bg, slate-400 symbols
} as const;

export function TitlebarSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const api = window.synthetix?.setTitleBarColor;
    if (!api) return; // plain browser, not Electron
    const colors = resolvedTheme === "dark" ? TITLEBAR_COLORS.dark : TITLEBAR_COLORS.light;
    void api(colors.bg, colors.symbol);
  }, [resolvedTheme]);

  return null;
}
