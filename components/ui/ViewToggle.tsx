'use client';

import type { PlannerViewMode } from '@/types';

interface ViewToggleProps {
  value: PlannerViewMode;
  onChange: (v: PlannerViewMode) => void;
}

const OPTIONS = [
  { label: 'Day',   value: 'day'   as const, enabled: true  },
  { label: 'Week',  value: 'week'  as const, enabled: true  },
  { label: 'Month', value: 'month' as const, enabled: true  },
  { label: 'Year',  value: null,              enabled: false },
] as const;

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
      {OPTIONS.map((opt) => {
        const isActive = opt.enabled && opt.value === value;
        return (
          <button
            key={opt.label}
            disabled={!opt.enabled}
            onClick={() => opt.enabled && opt.value && onChange(opt.value)}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-medium transition-all select-none',
              !opt.enabled
                ? 'text-[var(--color-text-muted)] opacity-35 cursor-not-allowed'
                : isActive
                ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)] cursor-pointer'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
