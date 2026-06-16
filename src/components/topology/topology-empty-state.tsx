"use client";

import Link from "next/link";
import { ArrowRight, FileText, Link2, Network, PenLine } from "lucide-react";
import { useLocale } from "@/lib/i18n";

interface TopologyEmptyStateProps {
  readonly variant?: "no-topology" | "no-drafts";
}

export function TopologyEmptyState({ variant = "no-topology" }: TopologyEmptyStateProps) {
  const { t } = useLocale();
  const stepIcons = [FileText, PenLine, Link2];
  const description = variant === "no-drafts" ? t.topology.noDraftsDesc : t.topology.emptyDesc;
  const steps = variant === "no-drafts" ? t.topology.noDraftsSteps : t.topology.emptySteps;
  const hint = variant === "no-drafts" ? t.topology.createDraftHint : t.topology.switchDraftHint;

  return (
    <div className="relative min-h-[calc(100vh-var(--header-height)-180px)] overflow-hidden rounded-[16px] border border-border bg-card">
      <div
        className="absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="absolute inset-0 bg-muted/35" />

      <div className="relative flex min-h-[calc(100vh-var(--header-height)-180px)] items-center justify-center px-6 py-14">
        <div className="flex w-full max-w-[520px] flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <Network className="h-8 w-8" />
          </div>

          <h2 className="mb-2 text-base font-semibold text-foreground">{t.topology.empty}</h2>
          <p className="max-w-[460px] text-sm leading-6 text-muted-foreground">{description}</p>

          <div className="mt-7 grid w-full gap-2 sm:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = stepIcons[index] ?? FileText;
              return (
                <div key={step} className="flex min-h-12 items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-left shadow-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-medium leading-5 text-foreground/80">{step}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex flex-col items-center gap-3">
            <Link
              href="/writing"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-light"
            >
              {t.topology.goWriting}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="max-w-[420px] text-xs leading-5 text-muted-foreground">{hint}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
