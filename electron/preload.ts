/**
 * Preload script. Runs in an isolated context with Node access.
 *
 * Currently exposes only version/platform info to the renderer. Kept minimal on
 * purpose — the renderer is just the Next.js web UI loaded over http; it does
 * not need native bridges today. Add IPC channels here only when a feature
 * genuinely needs main-process privileges (file dialogs, native notifications).
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("synthetix", {
  version: process.env.npm_package_version ?? "0.0.0",
  platform: process.platform,
  isPackaged: process.env.ELECTRON_IS_PACKAGED === "1",
  // Update the title bar overlay to match the page background (light/dark).
  // No-op outside Electron (e.g. plain browser); the renderer checks existence.
  setTitleBarColor: (bg: string, symbol: string) =>
    ipcRenderer.invoke("synthetix:set-titlebar-color", bg, symbol),

  // Auto-update bridge. The renderer accesses this through src/lib/update-bridge,
  // which guards for the browser (self-hosted web) case where window.synthetix
  // is undefined. Each method maps 1:1 to a main-process IPC handler in main.ts.
  update: {
    getStatus: () => ipcRenderer.invoke("synthetix:update:get-status"),
    checkNow: () => ipcRenderer.invoke("synthetix:update:check-now"),
    downloadAndInstall: () => ipcRenderer.invoke("synthetix:update:download-and-install"),
    // Granular download/install split (Stage 1.1 of the online-update design).
    // The UI offers "download now" and, once ready, "install" as separate user
    // actions; cancel lets a user abort an in-flight download.
    startDownload: () => ipcRenderer.invoke("synthetix:update:start-download"),
    cancelDownload: () => ipcRenderer.invoke("synthetix:update:cancel-download"),
    installStaged: () => ipcRenderer.invoke("synthetix:update:install-staged"),
    // Subscribe to status pushes from the main process. Returns an unsubscribe.
    // `cb` receives the serialized UpdateStatus from updater.ts (kept loose here
    // as `unknown` to avoid a hard type dependency from the preload bundle).
    onProgress: (cb: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => cb(status);
      ipcRenderer.on("synthetix:update:progress", handler);
      return () => {
        ipcRenderer.removeListener("synthetix:update:progress", handler);
      };
    },
  },
});
