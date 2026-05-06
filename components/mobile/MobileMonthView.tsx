'use client';

import { usePlannerStore } from '@/store/usePlannerStore';
import { MonthViewColumn } from '@/components/columns/MonthViewColumn';

export function MobileMonthView() {
  const { monthViewMode, setMonthViewMode, monthTaskLayout, setMonthTaskLayout } = usePlannerStore();

  return (
    <div className="flex flex-col h-full">
      {/* Month-specific controls */}
      <div className="flex-shrink-0 flex items-center justify-center gap-2.5 px-4 py-2 bg-[var(--color-canvas)] border-b border-[var(--color-border)]">
        <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {(['grid', 'expanded'] as const).map((mode) => {
            const isActive = monthTaskLayout === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setMonthTaskLayout(mode)}
                className={[
                  'px-3 py-1 rounded-full text-[11px] font-medium transition-all select-none cursor-pointer',
                  isActive
                    ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                    : 'text-[var(--color-text-muted)]',
                ].join(' ')}
              >
                {mode === 'grid' ? 'Grid' : 'Expanded'}
              </button>
            );
          })}
        </div>
        <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {(['events', 'tasks'] as const).map((mode) => {
            const isActive = monthViewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setMonthViewMode(mode)}
                className={[
                  'px-3 py-1 rounded-full text-[11px] font-medium transition-all select-none cursor-pointer',
                  isActive
                    ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                    : 'text-[var(--color-text-muted)]',
                ].join(' ')}
              >
                {mode === 'events' ? 'Events' : 'Tasks'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <MonthViewColumn monthViewMode={monthViewMode} showEventTimes={false} />
      </div>
    </div>
  );
}
