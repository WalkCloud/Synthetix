"use client";

/**
 * Update status panel shown inside the About dialog.
 *
 * Renders differently per status kind (idle / checking / up-to-date / available
 * with release notes / downloading with progress / ready / installing / error).
 * The panel only mounts inside the Electron desktop app — the About dialog
 * gates it on isUpdateSupported(), so this component can assume the bridge
 * exists and skip the browser fallback.
 *
 * Stage 2.5: this now consumes the app-wide UpdateStatusProvider instead of
 * opening its own useUpdateStatus subscription. The Provider already runs
 * checkOnMount once at the root, so opening the About dialog no longer fires a
 * duplicate check; `refresh` is still exposed for the manual "check for
 * updates" affordance.
 *
 * Stage 2.6: the `available` branch now offers a "Later" button for non-forced
 * updates (the sidebar badge remains as the persistent reminder), and forced
 * updates suppress "Later" + render an alert role (Stage 1.4 behavior).
 */
import { useLocale } from "@/lib/i18n";
import { useUpdateStatusContext } from "@/lib/update-status-context";
import type { UpdateStatus } from "@/types/electron";

function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Pick the localized release-notes string for the active locale, else fall back. */
function pickReleaseNotes(
  notes: Record<string, string> | undefined,
  locale: string
): string | null {
  if (!notes) return null;
  return notes[locale] ?? notes["en"] ?? notes["zh-CN"] ?? null;
}

export function UpdatePanel() {
  const { t, locale } = useLocale();
  const { status, refresh, startDownload, cancelDownload, installStaged } =
    useUpdateStatusContext();

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-left">
      <StatusView
        status={status}
        locale={locale}
        t={t}
        onRetry={refresh}
        onStartDownload={startDownload}
        onCancelDownload={cancelDownload}
        onInstallStaged={installStaged}
      />
    </div>
  );
}

interface StatusViewProps {
  status: UpdateStatus;
  locale: string;
  t: ReturnType<typeof useLocale>["t"];
  onRetry: () => void;
  /** Download only (Stage 3 split). */
  onStartDownload: () => void;
  /** Cancel an in-flight download. */
  onCancelDownload: () => void;
  /** Apply a staged update (Stage 3 split). */
  onInstallStaged: () => void;
}

function StatusView({
  status,
  locale,
  t,
  onRetry,
  onStartDownload,
  onCancelDownload,
  onInstallStaged,
}: StatusViewProps) {
  switch (status.kind) {
    case "idle":
      return (
        <p className="text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onRetry}
            className="underline-offset-4 hover:underline"
          >
            {t.layout.about.update.checkForUpdates}
          </button>
        </p>
      );

    case "checking":
      return (
        <p className="text-center text-xs text-muted-foreground">
          {t.layout.about.update.checking}
        </p>
      );

    case "up-to-date":
      return (
        <p className="text-center text-xs text-emerald-600 dark:text-emerald-500">
          ✓ {t.layout.about.update.upToDate}
        </p>
      );

    case "available": {
      const sizeLabel = formatBytes(status.sizeBytes);
      const pathLabel =
        status.path === "patch"
          ? t.layout.about.update.patchLabel.replace("{size}", sizeLabel)
          : t.layout.about.update.fullLabel.replace("{size}", sizeLabel);
      const notes = pickReleaseNotes(status.releaseNotes, locale);
      const forced = status.forced === true;
      return (
        <div className="space-y-2" role={forced ? "alert" : undefined}>
          <p
            className={`text-center text-xs font-medium ${
              forced
                ? "text-orange-600 dark:text-orange-500"
                : "text-amber-600 dark:text-amber-500"
            }`}
          >
            {t.layout.about.update.newVersionAvailable.replace(
              "{version}",
              status.version
            )}
          </p>
          {forced ? (
            <p className="text-center text-[0.7rem] font-medium text-orange-600 dark:text-orange-500">
              {t.layout.about.update.mustUpdate}
            </p>
          ) : null}
          <p className="text-center text-[0.7rem] text-muted-foreground">{pathLabel}</p>
          {notes ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">
                {t.layout.about.update.releaseNotes}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-sans text-[0.7rem] leading-relaxed text-muted-foreground">
                {notes}
              </pre>
            </details>
          ) : null}
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={onStartDownload}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t.layout.about.update.downloadNow}
            </button>
            {/* Non-forced updates offer "Later" — the sidebar badge stays as a
                persistent reminder so the user isn't permanently dismissing. */}
            {!forced ? (
              <span className="text-xs text-muted-foreground">
                {t.layout.about.update.later}
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    case "downloading": {
      const pct = status.totalBytes > 0 ? Math.round(status.progress * 100) : 0;
      return (
        <div className="space-y-1.5">
          <p className="text-center text-xs text-muted-foreground">
            {t.layout.about.update.downloading}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-center font-mono text-[0.7rem] text-muted-foreground">
            {pct > 0
              ? t.layout.about.update.downloadProgress.replace("{percent}", String(pct))
              : `${formatBytes(status.downloadedBytes)} / ${formatBytes(
                  status.totalBytes
                )}`}
          </p>
          <div className="flex items-center justify-center pt-1">
            <button
              type="button"
              onClick={onCancelDownload}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              {t.layout.about.update.cancelDownload}
            </button>
          </div>
        </div>
      );
    }

    case "ready": {
      // Distinguish full (restart + reinstall) from patch (in-place apply):
      // full exits the app and hands off to NSIS; patch restarts the local
      // Next service without a full reinstall. Different CTA wording reflects
      // the different impact on the user's running session.
      const cta =
        status.path === "patch"
          ? t.layout.about.update.applyNow
          : t.layout.about.update.installNow;
      return (
        <div className="space-y-2">
          <p className="text-center text-xs text-emerald-600 dark:text-emerald-500">
            {t.layout.about.update.readyToInstall}
          </p>
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onInstallStaged}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {cta}
            </button>
          </div>
        </div>
      );
    }

    case "installing":
      return (
        <p className="text-center text-xs text-muted-foreground">
          {t.layout.about.update.installing}
        </p>
      );

    case "error":
      return (
        <div className="space-y-1.5">
          <p className="text-center text-xs text-destructive">{t.layout.about.update.error}</p>
          <p className="text-center text-[0.65rem] text-muted-foreground">{status.message}</p>
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              {t.layout.about.update.retry}
            </button>
          </div>
        </div>
      );
  }
}
