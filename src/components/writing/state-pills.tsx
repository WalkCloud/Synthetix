"use client";

import type { SectionStatus } from "@/types/writing";

interface StatePillsProps {
  status: SectionStatus;
}

const SECTION_STATES = [
  { key: "retrieving", label: "Retrieving" },
  { key: "generating", label: "Generating" },
  { key: "reviewing", label: "Reviewing" },
  { key: "summarized", label: "Summarized" },
] as const;

function getStateIndex(status: SectionStatus): number {
  const map: Record<string, number> = {
    pending: -1,
    retrieving: 0,
    generating: 1,
    comparing: 1,
    reviewing: 2,
    revising: 2,
    summarized: 3,
    locked: 3,
    failed: -1,
  };
  return map[status] ?? -1;
}

export function StatePills({ status }: StatePillsProps) {
  const currentIndex = getStateIndex(status);

  return (
    <div className="grid grid-cols-4 gap-1.5 mb-5">
      {SECTION_STATES.map((state, i) => {
        const isDone = currentIndex > i;
        const isActive = currentIndex === i;

        return (
          <div
            key={state.key}
            className={`text-[11px] py-1.5 px-2 rounded-lg text-center font-semibold ${
              isDone
                ? "bg-emerald-100 text-emerald-600"
                : isActive
                    ? "bg-primary-50 text-primary-700"
                    : "bg-secondary text-muted-foreground"
            }`}
          >
            {state.label}
          </div>
        );
      })}
    </div>
  );
}
