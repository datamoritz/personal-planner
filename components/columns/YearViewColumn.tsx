'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addDays,
  eachMonthOfInterval,
  endOfWeek,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import {
  selectGoogleAllDayEventsForDate,
  selectGoogleCalendarEntriesForDate,
  selectMyDayTasks,
  usePlannerStore,
} from '@/store/usePlannerStore';

type PreviewItem = {
  id: string;
  title: string;
  timeLabel: string;
  tone: 'all-day' | 'google' | 'task' | 'birthday';
  done?: boolean;
};

type YearDayData = {
  date: Date;
  dateString: string;
  inCurrentMonth: boolean;
  previewItems: PreviewItem[];
  allDayCount: number;
  timedEventCount: number;
  timedTaskCount: number;
};

type HoverPreview = {
  dateString: string;
  label: string;
  items: PreviewItem[];
  x: number;
  y: number;
};

const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function formatPreviewTime(time?: string) {
  if (!time) return '';
  const [rawHour, rawMinute] = time.split(':').map(Number);
  const hour = ((rawHour ?? 0) % 24 + 24) % 24;
  const minute = rawMinute ?? 0;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  if (minute === 0) return `${displayHour} ${suffix}`;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function dotToneClass(tone: PreviewItem['tone']) {
  if (tone === 'birthday') return 'bg-[#f59e0b]';
  if (tone === 'all-day') return 'bg-[var(--color-google-event-text)]';
  if (tone === 'google') return 'bg-[var(--color-google-event)]';
  return 'bg-[var(--color-accent)]';
}

function buildMonthWeeks(
  monthDate: Date,
  currentYearDate: Date,
  allDayEvents: ReturnType<typeof usePlannerStore.getState>['googleAllDayEvents'],
  googleEntries: ReturnType<typeof usePlannerStore.getState>['googleCalendarEntries'],
  tasks: ReturnType<typeof usePlannerStore.getState>['tasks'],
  forceSixWeeks: boolean,
) {
  const monthStart = startOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = forceSixWeeks
    ? addDays(gridStart, 41)
    : endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });

  const days: YearDayData[] = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    const dateString = format(day, 'yyyy-MM-dd');
    const dayAllDayEvents = selectGoogleAllDayEventsForDate(allDayEvents, dateString);
    const dayTimedEntries = selectGoogleCalendarEntriesForDate(googleEntries, dateString)
      .sort((a, b) => (a.startTime > b.startTime ? 1 : -1));
    const dayTimedTasks = selectMyDayTasks(tasks, dateString)
      .filter((task) => Boolean(task.startTime || task.endTime))
      .sort((a, b) => (a.startTime ?? '') > (b.startTime ?? '') ? 1 : -1);

    const previewItems: PreviewItem[] = [
      ...dayAllDayEvents.map((event) => ({
        id: event.id,
        title: event.title,
        timeLabel: 'all-day',
        tone: event.source === 'apple_birthdays' ? 'birthday' as const : 'all-day' as const,
      })),
      ...dayTimedEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        timeLabel: formatPreviewTime(entry.startTime),
        tone: 'google' as const,
      })),
      ...dayTimedTasks.map((task) => ({
        id: task.id,
        title: task.title,
        timeLabel: formatPreviewTime(task.startTime),
        tone: 'task' as const,
        done: task.status === 'done',
      })),
    ];

    days.push({
      date: day,
      dateString,
      inCurrentMonth: isSameMonth(day, currentYearDate),
      previewItems,
      allDayCount: dayAllDayEvents.length,
      timedEventCount: dayTimedEntries.length,
      timedTaskCount: dayTimedTasks.length,
    });
  }

  const weeks: YearDayData[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function HoverPreviewCard({ preview }: { preview: HoverPreview }) {
  const x = Math.min(preview.x, window.innerWidth - 280);
  const y = Math.min(preview.y, window.innerHeight - 220);

  return createPortal(
    <div
      className="pointer-events-none fixed z-[140] w-[260px] rounded-[1.35rem] border border-white/12 bg-[color-mix(in_srgb,var(--color-canvas)_92%,black_8%)] px-3 py-3 text-[var(--color-text-primary)] shadow-[0_24px_60px_rgba(15,23,42,0.28)] backdrop-blur-xl"
      style={{ left: x, top: y }}
    >
      <div className="text-[12px] font-medium text-[var(--color-text-secondary)]">{preview.label}</div>
      {preview.items.length === 0 ? (
        <div className="mt-2 text-[12px] text-[var(--color-text-muted)]">No all-day events or timed items.</div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {preview.items.slice(0, 4).map((item) => (
            <div key={item.id} className="flex items-start gap-2 rounded-[0.95rem] px-1 py-1">
              <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${dotToneClass(item.tone)}`} />
              <div className="min-w-0 flex-1">
                <div className={['truncate text-[13px]', item.done ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'].join(' ')}>
                  {item.title}
                </div>
              </div>
              <span className="flex-shrink-0 text-[11px] text-[var(--color-text-muted)]">{item.timeLabel}</span>
            </div>
          ))}
          {preview.items.length > 4 && (
            <div className="pt-1 text-[11px] text-[var(--color-text-muted)]">
              +{preview.items.length - 4} more
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

export function YearViewColumn() {
  const currentDate = usePlannerStore((s) => s.currentDate);
  const tasks = usePlannerStore((s) => s.tasks);
  const googleCalendarEntries = usePlannerStore((s) => s.googleCalendarEntries);
  const googleAllDayEvents = usePlannerStore((s) => s.googleAllDayEvents);
  const yearPreviewEnabled = usePlannerStore((s) => s.yearPreviewEnabled);
  const setCurrentDate = usePlannerStore((s) => s.setCurrentDate);
  const setViewMode = usePlannerStore((s) => s.setViewMode);
  const [hoveredPreview, setHoveredPreview] = useState<HoverPreview | null>(null);

  const selectedDate = parseISO(currentDate);
  const currentYearStart = startOfYear(selectedDate);
  const currentYearEnd = endOfYear(selectedDate);
  const today = new Date();

  const monthData = eachMonthOfInterval({ start: currentYearStart, end: currentYearEnd }).map((monthDate) => ({
    monthDate,
    weeks: buildMonthWeeks(
      monthDate,
      monthDate,
      googleAllDayEvents,
      googleCalendarEntries,
      tasks,
      !yearPreviewEnabled,
    ),
  }));

  return (
    <div
      className={[
        'flex h-full min-h-0 flex-col border-t-2 border-t-[var(--color-accent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-center-col)_96%,white_4%),var(--color-center-col))]',
        yearPreviewEnabled ? 'overflow-y-auto px-8 py-7' : 'overflow-hidden px-6 py-5',
      ].join(' ')}
      style={{ marginTop: '-2px' }}
      onMouseLeave={() => setHoveredPreview(null)}
    >
      <div
        className={[
          'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
          yearPreviewEnabled ? 'gap-x-8 gap-y-10' : 'h-full gap-x-8 gap-y-8',
        ].join(' ')}
      >
        {monthData.map(({ monthDate, weeks }) => (
          <section
            key={format(monthDate, 'yyyy-MM')}
            className={[
              'min-w-0',
              yearPreviewEnabled ? '' : 'mx-auto flex min-h-0 w-full max-w-[370px] flex-col',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => {
                setCurrentDate(format(monthDate, 'yyyy-MM-dd'));
                setViewMode('month');
              }}
              className={[
                'font-semibold tracking-tight text-[var(--color-text-primary)] transition-colors text-left cursor-pointer',
                yearPreviewEnabled ? 'mb-3 text-[17px]' : 'mb-1 text-[15px]',
                'hover:text-[var(--color-accent)]',
              ].join(' ')}
            >
              {format(monthDate, 'MMMM')}
            </button>
            <div className={['grid grid-cols-7', yearPreviewEnabled ? 'gap-y-1' : 'flex-1 gap-y-0'].join(' ')}>
              {WEEK_LABELS.map((label, index) => (
                <div
                  key={`${label}-${index}`}
                  className={[
                    'text-center uppercase tracking-[0.12em] text-[var(--color-text-muted)]',
                    yearPreviewEnabled ? 'pb-1 text-[11px]' : 'pb-0 text-[10px]',
                    index >= 5 ? 'font-normal opacity-70' : 'font-medium',
                  ].join(' ')}
                >
                  {label}
                </div>
              ))}
              {weeks.flat().map((day) => {
                const isTodayCell = isSameDay(day.date, today);
                const isInMonthToday = isTodayCell && day.inCurrentMonth;
                const isSelected = isSameDay(day.date, selectedDate);
                const hasActivity = day.previewItems.length > 0;
                const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                const previewLabel = format(day.date, 'EEEE, MMM d');
                return (
                  <button
                    key={day.dateString}
                    type="button"
                    onClick={() => {
                      setCurrentDate(day.dateString);
                      setViewMode('day');
                    }}
                    onMouseEnter={(event) => {
                      if (!yearPreviewEnabled) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      setHoveredPreview({
                        dateString: day.dateString,
                        label: previewLabel,
                        items: day.previewItems,
                        x: rect.right + 12,
                        y: rect.top - 12,
                      });
                    }}
                    onFocus={(event) => {
                      if (!yearPreviewEnabled) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      setHoveredPreview({
                        dateString: day.dateString,
                        label: previewLabel,
                        items: day.previewItems,
                        x: rect.right + 12,
                        y: rect.top - 12,
                      });
                    }}
                    className={[
                      'group relative flex items-center justify-center font-medium transition-all',
                      yearPreviewEnabled
                        ? 'aspect-square min-h-[34px] rounded-[0.9rem] text-[13px]'
                        : isInMonthToday
                        ? 'justify-self-center h-6 w-6 rounded-full px-0 text-[13px] leading-none'
                        : 'justify-self-center h-6 min-w-[18px] rounded-full px-1 text-[13px] leading-none',
                      day.inCurrentMonth
                        ? 'text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-muted)] opacity-42',
                      !isInMonthToday && isWeekend ? 'font-normal opacity-80' : '',
                      isInMonthToday
                        ? yearPreviewEnabled
                          ? 'bg-red-500 text-white shadow-[0_10px_20px_rgba(239,68,68,0.2)] hover:bg-red-600'
                          : 'bg-red-500 text-white'
                        : isSelected && yearPreviewEnabled
                        ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                        : yearPreviewEnabled
                        ? 'hover:bg-[var(--color-surface-raised)]/75'
                        : '',
                    ].join(' ')}
                  >
                    <span>{format(day.date, 'd')}</span>
                    {yearPreviewEnabled && hasActivity && !isTodayCell && (
                      <div className="pointer-events-none absolute inset-x-1.5 bottom-1 flex items-center justify-center gap-1">
                        {day.allDayCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />}
                        {day.timedEventCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-google-event)]" />}
                        {day.timedTaskCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {yearPreviewEnabled && hoveredPreview && <HoverPreviewCard preview={hoveredPreview} />}
    </div>
  );
}
