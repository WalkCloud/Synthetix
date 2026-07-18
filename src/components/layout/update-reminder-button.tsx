"use client";

/**
 * Sidebar "new version available" reminder button.
 *
 * Mounted once inside the dashboard Sidebar (above the user avatar). Sits on
 * the app-wide UpdateStatusProvider so it doesn't open its own IPC
 * subscription. Uses a <button>, NOT an <a>/<Link>, so it does not increment
 * the `aside a` count that e2e/navigation.spec.ts NAV-01 asserts equals 10.
 *
 * Click behavior:
 *   - available / downloading → open the About dialog (the detail/decision UI)
 *   - ready                   → install the staged update directly
 *   - installing              → disabled
 *
 * In a plain browser (no Electron bridge) the provider reports `supported =
 * false` and this component renders nothing.
 */
import { useLocale } from "@/lib/i18n";
import { useUpdateStatusContext } from "@/lib/update-status-context";
import { getReminderState } from "@/lib/update-reminder-state";

interface UpdateReminderButtonProps {
  /** Open the About dialog (the existing update-detail surface). */
  onOpenAbout: () => void;
}

export function UpdateReminderButton({ onOpenAbout }: UpdateReminderButtonProps) {
  const { supported, status, install } = useUpdateStatusContext();
  const { t } = useLocale();

  // Hidden in plain browser / when no actionable update state.
  if (!supported) return null;
  const state = getReminderState(status);
  if (!state.visible) return null;

  const labelTemplate = t.layout.about.update[state.labelKey];
  const label = fillTemplate(labelTemplate, state.params);

  const handleClick = () => {
    if (state.disabled) return;
    if (state.action === "install") {
      install();
      return;
    }
    if (state.action === "open-about") {
      onOpenAbout();
    }
  };

  // aria-label includes the variant so screen readers announce urgency.
  const ariaLabel = `${label}${state.variant === "forced" ? " — ${t.layout.about.update.mustUpdate}" : ""}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state.disabled}
      aria-label={ariaLabel.replace("${t.layout.about.update.mustUpdate}", t.layout.about.update.mustUpdate)}
      className={classNameFor(state.variant, state.disabled)}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon variant={state.variant} />
        <span className="truncate text-[12px] font-medium">{label}</span>
      </span>
      {state.progressPct !== null && (
        <span
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-background/60"
          role="progressbar"
          aria-valuenow={state.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${state.progressPct}%` }}
          />
        </span>
      )}
    </button>
  );
}

/** Replace {key} placeholders in a template string. */
function fillTemplate(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? `{${k}}`);
}

function classNameFor(
  variant: string,
  disabled: boolean,
): string {
  const base =
    "mb-2 flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";
  if (disabled) {
    return `${base} cursor-not-allowed border-border bg-muted/40 text-muted-foreground opacity-70`;
  }
  switch (variant) {
    case "forced":
      // Stronger orange than "available" — signals must-update, not just info.
      return `${base} border-orange-300/60 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-950/40 dark:text-orange-300`;
    case "available":
      // Amber: "needs attention" per the design doc color semantics.
      return `${base} border-amber-300/60 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300`;
    case "downloading":
      return `${base} border-border bg-muted/40 text-muted-foreground hover:bg-muted/60`;
    case "ready":
      // Primary: an actionable "install now" CTA.
      return `${base} border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/15`;
    case "installing":
      return `${base} border-border bg-muted/40 text-muted-foreground opacity-70`;
    default:
      return base;
  }
}

function Icon({ variant }: { variant: string }) {
  // Inline SVGs keep this dependency-free and tree-shakeable; lucide-react
  // icons could also be used but the project's existing sidebar uses inline
  // SVGs for nav items, so this matches the local idiom.
  const common = {
    className: "h-[16px] w-[16px] shrink-0",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (variant) {
    case "ready":
      // download-complete / install arrow
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m6 11 6 6 6-6" />
          <path d="M5 21h14" />
        </svg>
      );
    case "downloading":
    case "installing":
      // circular spinner-ish arrow
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case "forced":
      // alert triangle
      return (
        <svg {...common}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "available":
    default:
      // down arrow (new version to fetch)
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      );
  }
}
