'use client';

import { Plus } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  count?: number;
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
}

export function SectionHeader({
  title,
  count,
  onAdd,
  addLabel = 'Add',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="ui-section-label">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="text-[9px] font-semibold w-4 h-4 flex items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-muted)]">
            {count}
          </span>
        )}
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addLabel}
          className="ui-icon-button"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
