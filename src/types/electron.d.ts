/**
 * Global type declaration for the `window.synthetix` Electron preload bridge.
 *
 * This is the single source of truth for the bridge surface; consumers
 * (titlebar-sync, update-bridge, About dialog) import the types from here
 * rather than redeclaring `declare global`. Both the `synthetix` field and
 * every method on it are optional, so the renderer degrades to a type-safe
 * no-op when running in a plain browser (self-hosted web mode, where the
 * preload script never ran and `window.synthetix` is `undefined`).
 */

/** Update status discriminated union — mirrors electron/updater.ts UpdateStatus. */
export type UpdatePath = "patch" | "full";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; latestVersion: string; checkedAt: string }
  | {
      kind: "available";
      path: UpdatePath;
      version: string;
      releaseName?: string;
      sizeBytes: number;
      releaseNotes?: Record<string, string>;
      forced: boolean;
    }
  | {
      kind: "downloading";
      path: UpdatePath;
      version: string;
      progress: number;
      downloadedBytes: number;
      totalBytes: number;
    }
  | { kind: "ready"; path: UpdatePath; version: string; stagedPath: string }
  | { kind: "installing"; path: UpdatePath; version: string }
  | { kind: "error"; message: string };

/** The auto-update IPC surface exposed by electron/preload.ts. */
export interface UpdateBridge {
  getStatus: () => Promise<UpdateStatus>;
  checkNow: () => Promise<UpdateStatus>;
  /** Combined download + apply (legacy "立即更新"). */
  downloadAndInstall: () => Promise<void>;
  /** Download only; leaves the update staged at `ready` for the user to install. */
  startDownload: () => Promise<UpdateStatus>;
  /** Abort an in-flight download (no-op if not downloading). */
  cancelDownload: () => Promise<UpdateStatus>;
  /** Apply a staged update (requires status `ready`). */
  installStaged: () => Promise<void>;
  /** Subscribe to status pushes; returns an unsubscribe function. */
  onProgress: (cb: (status: UpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    synthetix?: {
      version?: string;
      platform?: string;
      isPackaged?: boolean;
      setTitleBarColor?: (bg: string, symbol: string) => Promise<unknown>;
      update?: UpdateBridge;
    };
  }
}

export {};
