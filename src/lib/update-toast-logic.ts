/**
 * Pure logic that decides whether the "new version detected" toast should fire.
 *
 * Extracted from the React layer so it can be unit-tested in vitest's default
 * node environment (the repo has no React component test harness — see
 * docs/online-update-capability-analysis-and-design.md §2.7).
 *
 * Notification rule:
 *   fire exactly once per target version, the first time the status transitions
 *   INTO `available` (or `ready`, in case the user wasn't around for the check)
 *   from any other state. Re-checks that re-confirm the same version, or
 *   transitions among non-available states, do not re-notify. Forced updates
 *   always re-notify once even if the version was already notified (so the user
 *   can't miss a must-update).
 */

/** Minimal status shape this logic needs (avoids importing the full union). */
export interface NotificationStatus {
  kind:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  version?: string;
  forced?: boolean;
}

/** Return value of {@link shouldShowUpdateToast}. */
export interface ToastDecision {
  /** True iff a toast should be shown for this transition. */
  notify: boolean;
  /** The target version to record as "notified" when notify is true. */
  version?: string;
}

/**
 * @param prev       Previous status (use `{ kind: "idle" }` for the seed).
 * @param next       Current status.
 * @param notified   Set of versions already toasted in this session.
 */
export function shouldShowUpdateToast(
  prev: NotificationStatus,
  next: NotificationStatus,
  notified: ReadonlySet<string>,
): ToastDecision {
  const isUpdateAvailableState =
    next.kind === "available" || next.kind === "ready";
  if (!isUpdateAvailableState) return { notify: false };

  const version = next.version;
  if (!version) return { notify: false };

  // Forced updates re-notify even if we already toasted the version, so a user
  // who dismissed the first toast still gets reminded of a must-update.
  if (next.forced) {
    return { notify: true, version };
  }

  // Non-forced: notify once per version per session.
  if (notified.has(version)) return { notify: false };

  // Only notify on the *transition* into available/ready, not on every status
  // push that re-confirms it (the main process pushes frequently during
  // downloads and re-checks).
  const prevWasAvailable =
    prev.kind === "available" || prev.kind === "ready";
  if (prevWasAvailable && prev.version === version) {
    return { notify: false };
  }

  return { notify: true, version };
}
