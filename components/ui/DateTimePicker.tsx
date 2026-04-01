'use client';

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
  'w-full min-w-0 bg-[var(--color-surface)] border border-[var(--color-popover-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors';

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
    <div className="flex flex-col gap-2.5">
      {/* Date */}
      <div>
        <input
          type="date"
          value={date ?? ''}
          onChange={(e) => onDateChange(e.target.value || undefined)}
          className={`${inputCls} cursor-pointer`}
        />
      </div>

      {/* Time */}
      {hasTime && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <input
            type="time"
            value={startTime ?? ''}
            onChange={(e) => onStartTimeChange?.(e.target.value)}
            className={`${inputCls} text-center cursor-pointer`}
          />
          <span className="px-0.5 text-[var(--color-text-muted)] text-sm leading-none select-none">–</span>
          <input
            type="time"
            value={endTime ?? ''}
            onChange={(e) => onEndTimeChange?.(e.target.value)}
            className={`${inputCls} text-center cursor-pointer`}
          />
        </div>
      )}
    </div>
  );
}
