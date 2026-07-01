"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { formatFileSize } from "@/lib/text/format-file-size";
import {
  estimateProcessingRange,
  formatDurationRange,
  type ProcessingLevel,
} from "@/lib/documents/estimate";

interface ProcessingNoticeProps {
  /** Total bytes across the uploaded (completed) files. */
  totalBytes: number;
  /** Number of completed uploads in the batch. */
  fileCount: number;
  /** Current index mode — graph extraction roughly multiplies the time. */
  indexMode: "basic" | "graph";
  /**
   * Where the notice is shown.
   * - "queued": files are uploaded but processing hasn't started yet — the user
   *   still has to click "Start Processing". Copy frames the time as a heads-up
   *   for the upcoming run.
   * - "submitted": processing has actually been kicked off. Copy frames it as a
   *   background job the user can walk away from.
   */
  variant?: "queued" | "submitted";
}

interface TierStyle {
  /** Left rail + icon badge color classes (light/dark). */
  iconWrap: string;
  /** Title text color. */
  title: string;
}

const TIER_STYLES: Record<ProcessingLevel, TierStyle> = {
  fast: {
    iconWrap: "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
    title: "text-sky-700 dark:text-sky-300",
  },
  medium: {
    iconWrap: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
    title: "text-amber-700 dark:text-amber-300",
  },
  slow: {
    iconWrap: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300",
    title: "text-orange-700 dark:text-orange-300",
  },
  heavy: {
    iconWrap: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300",
    title: "text-violet-700 dark:text-violet-300",
  },
};

function TierIcon({ level }: { level: ProcessingLevel }) {
  // One stroke-based glyph per tier, all on a 24px grid.
  if (level === "fast") {
    // lightning bolt
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }
  if (level === "medium") {
    // hourglass
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M6 2h12M6 22h12" />
        <path d="M6 2c0 6 6 6 6 10s-6 4-6 10" />
        <path d="M18 2c0 6-6 6-6 10s6 4 6 10" />
      </svg>
    );
  }
  if (level === "slow") {
    // coffee
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
        <line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" />
      </svg>
    );
  }
  // heavy: stack of documents
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  );
}

export function ProcessingNotice({
  totalBytes,
  fileCount,
  indexMode,
  variant = "submitted",
}: ProcessingNoticeProps) {
  const { t, format } = useLocale();
  if (totalBytes <= 0 || fileCount <= 0) return null;

  const n = t.documents.processingNotice;
  const graphMode = indexMode === "graph";
  const estimate = estimateProcessingRange(totalBytes, graphMode);
  const style = TIER_STYLES[estimate.level];

  // The "queued" variant (pre-Start-Processing) uses a dedicated body so the
  // messaging is accurate: nothing is running yet, this is an estimate of the
  // upcoming run. The "submitted" variant keeps the original post-submit copy.
  const bodyText = variant === "queued" ? n.queuedBody : n.body;

  const titleKey =
    estimate.level === "fast" ? n.fastTitle
    : estimate.level === "medium" ? n.mediumTitle
    : estimate.level === "slow" ? n.slowTitle
    : n.heavyTitle;

  const range = formatDurationRange(estimate.minMin, estimate.maxMin, {
    seconds: n.seconds,
    minutes: n.minutes,
    mixed: n.mixed,
  });
  const estimatedTime = format.template(n.estimatedTime, { range });

  return (
    <div className="bg-card border border-border rounded-[16px] shadow-sm mb-6 animate-fade-in-up overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        {/* Tier icon */}
        <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${style.iconWrap}`}>
          <TierIcon level={estimate.level} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
            <h3 className={`text-[15px] font-semibold leading-tight ${style.title}`}>{titleKey}</h3>
            <span className="text-[12px] text-muted-foreground">
              {fileCount > 1
                ? `${formatFileSize(totalBytes)} · ${fileCount} files`
                : formatFileSize(totalBytes)}
            </span>
          </div>

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {bodyText}
            {graphMode && n.graphBodySuffix}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-muted-foreground">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {estimatedTime}
            </span>

            <Link
              href="/library"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary-light transition-colors"
            >
              {n.viewProgress}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
