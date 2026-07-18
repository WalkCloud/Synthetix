"use client";

/**
 * Global update-status provider.
 *
 * The repo's existing `useUpdateStatus` hook (src/lib/update-bridge.ts) opens
 * its own IPC subscription every time it's called. Before this provider, the
 * only consumer was the About dialog, which mounts on demand, so duplicate
 * subscriptions were never a problem. Stage 2 of the online-update design adds
 * a second consumer — the sidebar's UpdateReminderButton — which is always
 * mounted in the dashboard shell. Mounting two independent hooks would create
 * two parallel IPC subscriptions and two `checkNow()` calls.
 *
 * This provider subscribes exactly once at the app root (via `useUpdateStatus`)
 * and re-exposes the status through context. Both the sidebar button and the
 * About dialog consume it, so:
 *   - there is a single source of truth for update state,
 *   - the periodic check fires once,
 *   - the "first detection" toast is fired from one place.
 *
 * Browser/self-hosted-web: when no Electron bridge exists, the underlying hook
 * returns `{ kind: "idle" }` forever and `isUpdateSupported()` is false; this
 * provider then renders children unchanged and never toasts.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import {
  useUpdateStatus,
  isUpdateSupported,
} from "@/lib/update-bridge";
import { shouldShowUpdateToast } from "@/lib/update-toast-logic";
import type { UpdateStatus } from "@/types/electron";

interface UpdateStatusContextValue {
  status: UpdateStatus;
  /** True iff an Electron update bridge is present (false in plain browser). */
  supported: boolean;
  /** Re-run update check (e.g. the About "check for updates" button). */
  refresh: () => void;
  /** Convenience: download + apply (legacy combined action). */
  install: () => void;
  /** Download only; leave staged at `ready` for explicit install. */
  startDownload: () => void;
  /** Abort an in-flight download. */
  cancelDownload: () => void;
  /** Apply a staged update (status `ready`). */
  installStaged: () => void;
}

const UpdateStatusContext = createContext<UpdateStatusContextValue>({
  status: { kind: "idle" },
  supported: false,
  refresh: () => {},
  install: () => {},
  startDownload: () => {},
  cancelDownload: () => {},
  installStaged: () => {},
});

export function UpdateStatusProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const supported = isUpdateSupported();
  // Single subscription for the whole app. We DO check on mount so the sidebar
  // badge reflects the latest state without the user opening About.
  const { status, refresh, install, startDownload, cancelDownload, installStaged } =
    useUpdateStatus(true);

  const prevStatusRef = useRef<UpdateStatus>({ kind: "idle" });
  const notifiedVersionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const decision = shouldShowUpdateToast(
      prevStatusRef.current,
      status,
      notifiedVersionsRef.current,
    );
    if (decision.notify && decision.version) {
      notifiedVersionsRef.current.add(decision.version);
      const title = t.layout.about.update.newVersionToast.replace(
        "{version}",
        decision.version,
      );
      const actionLabel = t.layout.about.update.viewUpdate;
      // No onClick destination here — the toast just informs; the sidebar
      // button provides the persistent entry point. (sonner toasts are
      // ephemeral and we don't want to steal focus from the user's work.)
      toast.success(title, {
        action: { label: actionLabel, onClick: () => {} },
      });
    }
    prevStatusRef.current = status;
  }, [status, t]);

  return (
    <UpdateStatusContext.Provider
      value={{ status, supported, refresh, install, startDownload, cancelDownload, installStaged }}
    >
      {children}
    </UpdateStatusContext.Provider>
  );
}

export function useUpdateStatusContext(): UpdateStatusContextValue {
  return useContext(UpdateStatusContext);
}
