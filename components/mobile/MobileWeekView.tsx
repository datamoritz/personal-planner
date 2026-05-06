'use client';

import { addDays, format, isToday, startOfWeek } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import {
  usePlannerStore,
  selectTasksToday,
  selectMyDayTasks,
  selectGoogleCalendarEntriesForDate,
  selectGoogleAllDayEventsForDate,
} from '@/store/usePlannerStore';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MobileWeekView() {
  const {
    currentDate, tasks, googleCalendarEntries, googleAllDayEvents,
    setCurrentDate, setViewMode,
  } = usePlannerStore();

  const weekStart = startOfWeek(new Date(currentDate + 'T00:00:00'), { weekStartsOn: 1 });

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const ds = format(date, 'yyyy-MM-dd');
    const untimedTasks = selectTasksToday(tasks, ds);
    const timedTasks = selectMyDayTasks(tasks, ds);
    const googleTimed = selectGoogleCalendarEntriesForDate(googleCalendarEntries, ds);
    const allDay = selectGoogleAllDayEventsForDate(googleAllDayEvents, ds);
    return {
      date,
      dateString: ds,
      dayName: DAY_NAMES[i],
      today: isToday(date),
      untimedTasks,
      timedTasks,
      googleTimed,
      allDay,
      totalItems: untimedTasks.length + timedTasks.length + googleTimed.length + allDay.length,
    };
  });

  const goToDay = (ds: string) => {
    setCurrentDate(ds);
    setViewMode('day');
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--color-canvas)]">
      {days.map((day) => (
        <button
          key={day.dateString}
          type="button"
          onClick={() => goToDay(day.dateString)}
          className={[
            'flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)] text-left w-full transition-colors',
            'active:bg-[var(--color-surface-raised)]',
            day.today ? 'bg-[var(--color-accent-subtle)]' : 'hover:bg-[var(--color-surface)]',
          ].join(' ')}
        >
          {/* Date column */}
          <div className="w-10 flex-shrink-0 flex flex-col items-center gap-0.5">
            <span className={[
              'text-[10px] font-semibold uppercase tracking-wide',
              day.today ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]',
            ].join(' ')}>
              {day.dayName}
            </span>
            <span className={[
              'text-[20px] font-bold leading-none',
              day.today ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]',
            ].join(' ')}>
              {format(day.date, 'd')}
            </span>
          </div>

          {/* Summary column */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {day.allDay.slice(0, 2).map((ev) => (
              <div key={ev.id} className="text-[11px] text-[var(--color-text-secondary)] truncate leading-snug">
                {ev.title}
              </div>
            ))}
            {day.googleTimed.slice(0, 2).map((ev) => (
              <div key={ev.id} className="text-[11px] text-[var(--color-google-event-text)] truncate leading-snug">
                {ev.startTime.slice(0, 5)} {ev.title}
              </div>
            ))}
            {day.untimedTasks.length > 0 && (
              <div className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                {day.untimedTasks.length} task{day.untimedTasks.length !== 1 ? 's' : ''}
              </div>
            )}
            {day.totalItems === 0 && (
              <span className="text-[11px] text-[var(--color-text-muted)] italic leading-snug">Nothing planned</span>
            )}
          </div>

          <ChevronRight size={14} className="flex-shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
