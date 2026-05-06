"use client";

interface TopologyControlsProps {
  readonly drafts: readonly { id: string; title: string }[];
  readonly selectedDraftId: string | null;
  readonly onDraftChange: (id: string) => void;
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomFit: () => void;
  readonly refFilter: string;
  readonly onRefFilterChange: (value: string) => void;
  readonly groupBy: string;
  readonly onGroupByChange: (value: string) => void;
}

const REF_FILTER_OPTIONS = [
  { value: "all", label: "All References" },
  { value: "direct", label: "Direct References" },
  { value: "indirect", label: "Indirect References" },
] as const;

const GROUP_BY_OPTIONS = [
  { value: "document", label: "By document" },
  { value: "section", label: "By section" },
  { value: "anchor", label: "By citation anchor" },
] as const;

const SELECT_CLASSES =
  "px-[14px] py-2 border border-[#E4E4E7] rounded-lg text-[13px] bg-white text-[#18181B] outline-none focus:border-[#4361EE] focus:ring-1 focus:ring-[#4361EE] transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717A%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:right_10px_center] bg-no-repeat pr-8";

const ICON_BUTTON_CLASSES =
  "flex items-center justify-center w-9 h-9 rounded-lg text-[#52525B] hover:bg-[#F5F5F3] hover:text-[#18181B] transition-colors cursor-pointer";

export function TopologyControls({
  drafts,
  selectedDraftId,
  onDraftChange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  refFilter,
  onRefFilterChange,
  groupBy,
  onGroupByChange,
}: TopologyControlsProps) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Draft selector */}
      <select
        value={selectedDraftId ?? ""}
        onChange={(e) => onDraftChange(e.target.value)}
        className={SELECT_CLASSES}
      >
        <option value="" disabled>
          Select a draft...
        </option>
        {drafts.map((draft) => (
          <option key={draft.id} value={draft.id}>
            {draft.title}
          </option>
        ))}
      </select>

      {/* Zoom controls */}
      <div className="flex items-center gap-1 border border-[#E4E4E7] rounded-lg p-0.5">
        <button
          type="button"
          onClick={onZoomIn}
          className={ICON_BUTTON_CLASSES}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onZoomOut}
          className={ICON_BUTTON_CLASSES}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onZoomFit}
          className={ICON_BUTTON_CLASSES}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>

      {/* Reference filter */}
      <select
        value={refFilter}
        onChange={(e) => onRefFilterChange(e.target.value)}
        className={SELECT_CLASSES}
      >
        {REF_FILTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Group by */}
      <select
        value={groupBy}
        onChange={(e) => onGroupByChange(e.target.value)}
        className={SELECT_CLASSES}
      >
        {GROUP_BY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
