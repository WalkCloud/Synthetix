/**
 * Pure mapping from an UpdateStatus to the sidebar reminder button's view state.
 *
 * Extracted as a pure function so it can be unit-tested in vitest's default
 * node environment (the repo has no React component test harness). The React
 * component below is a thin wrapper over this function.
 */
import type { UpdateStatus } from "@/types/electron";

/** Visual emphasis levels; map to amber/orange/primary in the component. */
export type ReminderVariant = "available" | "forced" | "downloading" | "ready" | "installing";

/** Which action the button triggers when clicked. */
export type ReminderAction = "open-about" | "install" | "none";

export interface ReminderState {
  /** False → render nothing. */
  visible: boolean;
  variant: ReminderVariant;
  /** i18n key suffix under layout.about.update, e.g. "sidebarAvailable". */
  labelKey:
    | "sidebarAvailable"
    | "sidebarMustUpdate"
    | "sidebarDownloading"
    | "sidebarInstall"
    | "sidebarInstalling";
  /** Params for the {version}/{percent} template substitution. */
  params: Record<string, string>;
  action: ReminderAction;
  /** 0–100 progress when variant === "downloading", else null. */
  progressPct: number | null;
  /** Disable the button (e.g. while installing). */
  disabled: boolean;
}

const HIDDEN: ReminderState = {
  visible: false,
  variant: "available",
  labelKey: "sidebarAvailable",
  params: {},
  action: "none",
  progressPct: null,
  disabled: false,
};

/**
 * Decide what the sidebar reminder button should show for a given status.
 *
 * Visibility rule (from the design doc §9.1):
 *   - idle / checking / up-to-date            → hidden (no noise)
 *   - available (non-forced)                  → amber "new version"
 *   - available (forced)                      → orange "must update"
 *   - downloading                             → progress
 *   - ready                                   → primary "install"
 *   - installing                              → disabled spinner
 *   - error                                   → hidden (the About dialog
 *                                              surfaces errors; a persistent
 *                                              red sidebar badge would be
 *                                              noisy on transient failures)
 */
export function getReminderState(status: UpdateStatus): ReminderState {
  switch (status.kind) {
    case "available": {
      if (status.forced) {
        return {
          visible: true,
          variant: "forced",
          labelKey: "sidebarMustUpdate",
          params: { version: status.version },
          action: "open-about",
          progressPct: null,
          disabled: false,
        };
      }
      return {
        visible: true,
        variant: "available",
        labelKey: "sidebarAvailable",
        params: { version: status.version },
        action: "open-about",
        progressPct: null,
        disabled: false,
      };
    }

    case "downloading": {
      const pct =
        status.totalBytes > 0 ? Math.round(status.progress * 100) : 0;
      return {
        visible: true,
        variant: "downloading",
        labelKey: "sidebarDownloading",
        params: { percent: String(pct) },
        action: "open-about",
        progressPct: pct,
        disabled: false,
      };
    }

    case "ready": {
      return {
        visible: true,
        variant: "ready",
        labelKey: "sidebarInstall",
        params: { version: status.version },
        action: "install",
        progressPct: null,
        disabled: false,
      };
    }

    case "installing": {
      return {
        visible: true,
        variant: "installing",
        labelKey: "sidebarInstalling",
        params: {},
        action: "none",
        progressPct: null,
        disabled: true,
      };
    }

    case "idle":
    case "checking":
    case "up-to-date":
    case "error":
      return HIDDEN;
  }
}
