'use client';

import { useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import type { RecurrentTask, RecurrenceFrequency } from '@/types';

function formatFrequency(freq: RecurrenceFrequency): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (freq.type) {
    case 'daily':   return 'Daily';
    case 'weekly':  return `Every ${days[freq.dayOfWeek]}`;
    case 'monthly': return `Monthly (${freq.dayOfMonth}${ordinal(freq.dayOfMonth)})`;
    case 'custom-days':   return `Every ${freq.intervalDays}d`;
    case 'custom-weeks':  return `Every ${freq.intervalWeeks}w (${days[freq.dayOfWeek]})`;
    case 'custom-months': return `Every ${freq.intervalMonths}mo (${freq.dayOfMonth}${ordinal(freq.dayOfMonth)})`;
  }
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

interface RecurrentTaskPillProps {
  task: RecurrentTask;
  hasActiveInstance?: boolean; // true if a spawned pending instance exists for today or future
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onAdvance?: (id: string) => void;
}

export function RecurrentTaskPill({
  task,
  hasActiveInstance = false,
  onDoubleClick,
  onAdvance,
}: RecurrentTaskPillProps) {
  const today = useSyncExternalStore(
    () => () => {},
    () => format(new Date(), 'yyyy-MM-dd'),
    () => '',
  );
  // Highlight only when due AND no pending instance has been placed yet
  const isDue = today !== '' && task.nextDueDate <= today && !hasActiveInstance;

  return (
    <div
      onDoubleClick={(e) => onDoubleClick?.(task.id, e.currentTarget)}
      className={[
        'item-enter group flex items-center gap-2 px-2.5 py-2 rounded-[1rem] cursor-pointer select-none',
        'border transition-all duration-150',
        isDue
          ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-raised)]',
      ].join(' ')}
    >
      <button
        type="button"
        disabled={hasActiveInstance}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (hasActiveInstance) return;
          onAdvance?.(task.id);
        }}
        className={[
          'flex-shrink-0 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer',
          hasActiveInstance
            ? 'bg-[var(--color-accent)]/12 border-[var(--color-accent)] opacity-60 cursor-default'
            : isDue
            ? 'border-[var(--color-accent)]'
            : 'border-[var(--color-text-muted)]',
        ].join(' ')}
        aria-label={hasActiveInstance ? 'Recurrent task already has an active instance' : 'Mark recurrent task complete for this cycle'}
        title={hasActiveInstance ? 'Recurrent task already has an active instance' : 'Mark recurrent task complete for this cycle'}
      >
        {hasActiveInstance && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path d="M1 3L3 5L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <span className="flex-1 text-[14px] text-[var(--color-text-primary)] leading-tight truncate">
        {task.title}
      </span>

      <div className="flex-shrink-0 w-[15px] h-[15px] flex items-center justify-center">
        <RefreshCw
          size={12}
          className={isDue ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
          strokeWidth={2.5}
        />
      </div>

      <span className={[
        'text-[10px] whitespace-nowrap flex-shrink-0',
        isDue ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)]',
      ].join(' ')}>
        {formatFrequency(task.frequency)}
      </span>
    </div>
  );
}
