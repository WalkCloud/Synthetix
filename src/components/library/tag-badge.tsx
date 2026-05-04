interface TagBadgeProps {
  name: string;
  onRemove?: (name: string) => void;
}

export function TagBadge({ name, onRemove }: TagBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 text-primary rounded-full text-xs font-medium">
      {name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(name); }}
          className="hover:text-[#DC2626] transition-colors"
        >
          ×
        </button>
      )}
    </span>
  );
}
