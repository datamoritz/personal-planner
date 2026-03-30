'use client';

import { Clock, X } from 'lucide-react';

interface DateTimePickerProps {
  date?: string;
  startTime?: string;
  endTime?: string;
  showTime?: boolean;
  onDateChange: (date: string | undefined) => void;
  onStartTimeChange?: (time: string) => void;
  onEndTimeChange?: (time: string) => void;
}

const inputCls =
  'w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors cursor-pointer';

export function DateTimePicker({
  date,
  startTime,
  endTime,
  showTime = false,
  onDateChange,
  onStartTimeChange,
  onEndTimeChange,
}: DateTimePickerProps) {
  const hasTime = showTime || !!startTime;

  return (
    <div className="flex flex-col gap-2">
      {/* Date */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date ?? ''}
          onChange={(e) => onDateChange(e.target.value || undefined)}
          className={inputCls + ' flex-1'}
        />
        {date && (
          <button
            type="button"
            onClick={() => onDateChange(undefined)}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Time */}
      {hasTime && (
        <div className="flex items-center gap-2">
          <Clock size={11} className="flex-shrink-0 text-[var(--color-text-muted)] ml-0.5" strokeWidth={2} />
          <input
            type="time"
            value={startTime ?? ''}
            onChange={(e) => onStartTimeChange?.(e.target.value)}
            className={inputCls}
          />
          <span className="text-[var(--color-text-muted)] text-xs flex-shrink-0">–</span>
          <input
            type="time"
            value={endTime ?? ''}
            onChange={(e) => onEndTimeChange?.(e.target.value)}
            className={inputCls}
          />
        </div>
      )}
    </div>
  );
}
