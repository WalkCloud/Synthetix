"use client";

import type { SectionMeta } from "@/types/writing";

interface OutlinePanelProps {
  sections: SectionMeta[];
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
}

function getSectionStatus(status: string): "done" | "current" | "pending" {
  if (["summarized", "locked", "accepted"].includes(status)) return "done";
  if (["generating", "comparing", "reviewing", "retrieving"].includes(status)) return "current";
  return "pending";
}

export function OutlinePanel({ sections, activeSectionId, onSelectSection }: OutlinePanelProps) {
  const topLevelSections = sections.filter((s) => !s.parentId);
  const completedCount = sections.filter(
    (s) => s.status === "summarized" || s.status === "locked"
  ).length;
  const totalCount = sections.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="outline-panel bg-white border-r border-slate-200 p-5 overflow-y-auto h-full">
      <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-slate-900">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-[18px] h-[18px] text-primary-600"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        Outline
      </h3>

      {topLevelSections.map((section, parentIndex) => {
        const status = getSectionStatus(section.status);
        const isActive = section.id === activeSectionId;
        const children = sections.filter((s) => s.parentId === section.id);

        return (
          <div key={section.id}>
            <div
              onClick={() => onSelectSection(section.id)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700 font-semibold"
                  : status === "done"
                    ? "text-emerald-600"
                    : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  status === "done"
                    ? "bg-emerald-500"
                    : status === "current"
                      ? "bg-primary-600 animate-pulse"
                      : "bg-slate-200"
                }`}
              />
              {parentIndex + 1}. {section.title}
            </div>

            {children.length > 0 && (
              <div className="pl-7">
                {children.map((child, childIndex) => {
                  const childStatus = getSectionStatus(child.status);
                  const childActive = child.id === activeSectionId;

                  return (
                    <div
                      key={child.id}
                      onClick={() => onSelectSection(child.id)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
                        childActive
                          ? "bg-primary-50 text-primary-700 font-semibold"
                          : childStatus === "done"
                            ? "text-emerald-600"
                            : "text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          childStatus === "done"
                            ? "bg-emerald-500"
                            : childStatus === "current"
                              ? "bg-primary-600 animate-pulse"
                              : "bg-slate-200"
                        }`}
                      />
                      {parentIndex + 1}.{childIndex + 1}. {child.title}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-4 pt-4 border-t border-slate-200">
        <div className="text-xs text-slate-500 mb-1.5 font-medium">
          {completedCount} / {totalCount} sections completed
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-600 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
