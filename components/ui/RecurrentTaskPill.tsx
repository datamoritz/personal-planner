'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import type { RecurrentTask, RecurrenceFrequency } from '@/types';

function formatFrequency(freq: RecurrenceFrequency): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (freq.type) {
    case 'daily':   return 'Daily';
    case 'weekly':  return `Every ${days[freq.dayOfWeek]}`;
    case 'monthly': return `Monthly (${freq.dayOfMonth}${ordinal(freq.dayOfMonth)})`;
    case 'custom':  return `Every ${freq.intervalDays}d`;
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
}

export function RecurrentTaskPill({ task, hasActiveInstance = false, onDoubleClick }: RecurrentTaskPillProps) {
  const [today, setToday] = useState('');
  useEffect(() => { setToday(format(new Date(), 'yyyy-MM-dd')); }, []);
  // Highlight only when due AND no pending instance has been placed yet
  const isDue = today !== '' && task.nextDueDate <= today && !hasActiveInstance;

  return (
    <div
      onDoubleClick={(e) => onDoubleClick?.(task.id, e.currentTarget)}
      className={[
        'item-enter group flex items-center gap-2.5 px-3 py-2 rounded-full cursor-pointer select-none',
        'border transition-all duration-150',
        isDue
          ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-raised)]',
      ].join(' ')}
    >
      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        <RefreshCw
          size={12}
          className={isDue ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
          strokeWidth={2.5}
        />
      </div>

      <span className="flex-1 text-sm text-[var(--color-text-primary)] leading-tight truncate">
        {task.title}
      </span>

      <span className={[
        'text-[10px] whitespace-nowrap flex-shrink-0',
        isDue ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)]',
      ].join(' ')}>
        {formatFrequency(task.frequency)}
      </span>
    </div>
  );
}
