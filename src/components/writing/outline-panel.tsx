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
    <div className="outline-panel bg-white border-r border-[#E4E4E7] p-5 overflow-y-auto h-full">
      <h3
        className="text-sm font-bold mb-4 flex items-center gap-2"
        style={{ color: "#18181B" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4361EE"
          strokeWidth="2"
          className="w-[18px] h-[18px]"
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

      {topLevelSections.map((section) => {
        const status = getSectionStatus(section.status);
        const isActive = section.id === activeSectionId;
        const children = sections.filter((s) => s.parentId === section.id);

        return (
          <div key={section.id}>
            <div
              onClick={() => onSelectSection(section.id)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
                isActive
                  ? "bg-[#EEF0FD] text-[#4361EE] font-semibold"
                  : status === "done"
                    ? "text-[#16A34A]"
                    : "text-[#A1A1AA] hover:bg-[#EEEEE9]"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  status === "done"
                    ? "bg-[#16A34A]"
                    : status === "current"
                      ? "bg-[#4361EE] animate-pulse"
                      : "bg-[#E4E4E7]"
                }`}
              />
              {section.index + 1}. {section.title}
            </div>

            {children.length > 0 && (
              <div className="pl-7">
                {children.map((child) => {
                  const childStatus = getSectionStatus(child.status);
                  const childActive = child.id === activeSectionId;

                  return (
                    <div
                      key={child.id}
                      onClick={() => onSelectSection(child.id)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
                        childActive
                          ? "bg-[#EEF0FD] text-[#4361EE] font-semibold"
                          : childStatus === "done"
                            ? "text-[#16A34A]"
                            : "text-[#A1A1AA] hover:bg-[#EEEEE9]"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          childStatus === "done"
                            ? "bg-[#16A34A]"
                            : childStatus === "current"
                              ? "bg-[#4361EE] animate-pulse"
                              : "bg-[#E4E4E7]"
                        }`}
                      />
                      {child.title}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-4 pt-4 border-t border-[#E4E4E7]">
        <div className="text-xs text-[#52525B] mb-1.5">
          {completedCount} / {totalCount} sections completed
        </div>
        <div className="h-1.5 bg-[#ECECEA] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#4361EE] rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
