'use client';

interface ViewToggleProps {
  value: 'day' | 'week';
  onChange: (v: 'day' | 'week') => void;
}

const OPTIONS = [
  { label: 'Day',   value: 'day'   as const, enabled: true  },
  { label: 'Week',  value: 'week'  as const, enabled: true  },
  { label: 'Month', value: null,              enabled: false },
  { label: 'Year',  value: null,              enabled: false },
] as const;

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {OPTIONS.map((opt) => {
        const isActive = opt.enabled && opt.value === value;
        return (
          <button
            key={opt.label}
            disabled={!opt.enabled}
            onClick={() => opt.enabled && opt.value && onChange(opt.value)}
            className={[
              'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all select-none',
              !opt.enabled
                ? 'text-[var(--color-text-muted)] opacity-35 cursor-not-allowed'
                : isActive
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] shadow-sm cursor-pointer'
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
