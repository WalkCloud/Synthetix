/**
 * Renderer-side wrapper for the Electron auto-update bridge.
 *
 * The About dialog (and any other future consumer) reads update state through
 * this module rather than touching `window.synthetix` directly, so the
 * browser/self-hosted-web case is centralized here: when there is no Electron
 * preload bridge, every call degrades to `{ kind: "unsupported" }` and the UI
 * simply hides the update panel.
 *
 * The status type mirrors electron/updater.ts; the canonical declaration lives
 * in src/types/electron.d.ts (imported here for re-export).
 */
"use client";

import { useEffect, useState } from "react";
import type { UpdateStatus } from "@/types/electron";

export type { UpdateStatus, UpdatePath } from "@/types/electron";

/**
 * Status returned when there is no Electron bridge (plain browser / self-hosted
 * web). We model "unsupported" as `idle` rather than a separate `kind` so the
 * existing discriminated union stays exhaustive — callers that want to hide the
 * UI entirely should gate on `isUpdateSupported()`.
 */
const UNSUPPORTED: UpdateStatus = { kind: "idle" };

/**
 * True iff an Electron update bridge is present. Use this to decide whether to
 * render update UI at all (browser → hide the panel entirely).
 */
export function isUpdateSupported(): boolean {
  return typeof window !== "undefined" && !!window.synthetix?.update;
}

/** Read the current status once. Returns idle when unsupported. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const api = window.synthetix?.update;
  if (!api) return UNSUPPORTED;
  try {
    return await api.getStatus();
  } catch {
    return { kind: "error", message: "status unavailable" };
  }
}

/** Trigger a manual check for updates. No-op (returns idle) when unsupported. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  const api = window.synthetix?.update;
  if (!api) return UNSUPPORTED;
  try {
    return await api.checkNow();
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download (if needed) and install the available update. No-op when
 * unsupported or when no update is staged.
 */
export async function downloadAndInstallUpdate(): Promise<void> {
  const api = window.synthetix?.update;
  if (!api) return;
  try {
    await api.downloadAndInstall();
  } catch (e) {
    // The error is surfaced via the status subscription; swallow here.
    console.error("[update] downloadAndInstall failed:", e);
  }
}

/**
 * Download only (no install). Leaves the update staged at `ready` so the UI
 * can prompt the user to confirm the install explicitly. No-op when unsupported.
 */
export async function startDownloadUpdate(): Promise<UpdateStatus> {
  const api = window.synthetix?.update;
  if (!api) return UNSUPPORTED;
  try {
    return await api.startDownload();
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Cancel an in-flight download. No-op when unsupported. */
export async function cancelDownloadUpdate(): Promise<UpdateStatus> {
  const api = window.synthetix?.update;
  if (!api) return UNSUPPORTED;
  try {
    return await api.cancelDownload();
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Apply a staged update (requires status `ready`). No-op when unsupported or
 * when no update is staged.
 */
export async function installStagedUpdate(): Promise<void> {
  const api = window.synthetix?.update;
  if (!api) return;
  try {
    await api.installStaged();
  } catch (e) {
    console.error("[update] installStaged failed:", e);
  }
}

/**
 * React hook: subscribes to live status updates and also re-checks whenever the
 * caller asks (e.g. when the About dialog opens). Returns the latest status.
 *
 * In a plain browser this returns `{ kind: "idle" }` forever and never
 * attempts IPC — callers should gate the UI with `isUpdateSupported()` if they
 * want to hide it entirely, or use the `kind` to render a degraded state.
 *
 * `checkOnMount` triggers an immediate check when true (default). Set false to
 * just subscribe passively (e.g. for a global badge).
 */
export function useUpdateStatus(checkOnMount = true): {
  status: UpdateStatus;
  refresh: () => void;
  install: () => void;
  startDownload: () => void;
  cancelDownload: () => void;
  installStaged: () => void;
} {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });

  useEffect(() => {
    const api = window.synthetix?.update;
    if (!api) return; // browser: leave status idle, no subscriptions

    // 1) Subscribe to status pushes from the main process.
    const unsubscribe = api.onProgress((next) => setStatus(next));

    // 2) Seed with the current status immediately.
    let cancelled = false;
    void api.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });

    // 3) Optionally fire a fresh check now (About dialog open).
    if (checkOnMount) {
      void api.checkNow().then((s) => {
        if (!cancelled) setStatus(s);
      });
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [checkOnMount]);

  return {
    status,
    refresh: () => {
      void checkForUpdates().then(setStatus);
    },
    install: () => {
      void downloadAndInstallUpdate();
    },
    startDownload: () => {
      void startDownloadUpdate().then(setStatus);
    },
    cancelDownload: () => {
      void cancelDownloadUpdate().then(setStatus);
    },
    installStaged: () => {
      void installStagedUpdate();
    },
  };
}
