'use client';

interface DateTimePickerProps {
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  showTime?: boolean;
  showEndDate?: boolean;
  onDateChange: (date: string | undefined) => void;
  onEndDateChange?: (date: string | undefined) => void;
  onStartTimeChange?: (time: string) => void;
  onEndTimeChange?: (time: string) => void;
}

const inputCls =
  'ui-input';

export function DateTimePicker({
  date,
  endDate,
  startTime,
  endTime,
  showTime = false,
  showEndDate = false,
  onDateChange,
  onEndDateChange,
  onStartTimeChange,
  onEndTimeChange,
}: DateTimePickerProps) {
  const hasTime = showTime || !!startTime;

  return (
    <div className="flex flex-col gap-3">
      {showEndDate ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
          <input
            type="date"
            aria-label="Start date"
            value={date ?? ''}
            onChange={(e) => onDateChange(e.target.value || undefined)}
            className={`${inputCls} cursor-pointer`}
          />
          <span className="px-0.5 text-[var(--color-text-muted)] text-sm leading-none select-none">–</span>
          <input
            type="date"
            aria-label="End date"
            value={endDate ?? ''}
            onChange={(e) => onEndDateChange?.(e.target.value || undefined)}
            className={`${inputCls} cursor-pointer`}
          />
        </div>
      ) : (
        <div>
          <input
            type="date"
            value={date ?? ''}
            onChange={(e) => onDateChange(e.target.value || undefined)}
            className={`${inputCls} cursor-pointer`}
          />
        </div>
      )}

      {hasTime && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
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
