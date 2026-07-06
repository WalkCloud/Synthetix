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
});
