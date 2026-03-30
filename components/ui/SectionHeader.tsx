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
    <div className={`flex items-center justify-between px-3 py-1.5 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="text-[9px] font-semibold w-4 h-4 flex items-center justify-center rounded-full bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
            {count}
          </span>
        )}
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addLabel}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
