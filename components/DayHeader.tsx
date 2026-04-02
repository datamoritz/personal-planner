'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { endOfWeek, format, isSameMonth, isToday, parseISO, startOfWeek } from 'date-fns';
import { usePlannerStore } from '@/store/usePlannerStore';

function formatWeekRange(currentDate: string): string {
  const base  = new Date(currentDate + 'T00:00:00');
  const start = startOfWeek(base, { weekStartsOn: 1 });
  const end   = endOfWeek(base,   { weekStartsOn: 1 });
  if (isSameMonth(start, end)) {
    return `${format(start, 'MMM d')} – ${format(end, 'd')}`;
  }
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
}

function isCurrentWeek(currentDate: string): boolean {
  const today = new Date();
  const base  = new Date(currentDate + 'T00:00:00');
  const start = startOfWeek(base,  { weekStartsOn: 1 });
  const end   = endOfWeek(base,    { weekStartsOn: 1 });
  return today >= start && today <= end;
}

export function DayHeader() {
  const {
    currentDate, navigateDay, navigateWeek, navigateMonth, setCurrentDate,
    viewMode, monthViewMode, setMonthViewMode, monthTaskLayout, setMonthTaskLayout,
  } = usePlannerStore();

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const date       = parseISO(currentDate);
  const todayFlag  = mounted && isToday(date);
  const isWeek     = viewMode === 'week';
  const isMonth    = viewMode === 'month';
  const thisWeek   = mounted && isCurrentWeek(currentDate);
  const thisMonth  = mounted && isSameMonth(date, new Date());

  const navPrev = () => {
    if (isMonth) navigateMonth('prev');
    else if (isWeek) navigateWeek('prev');
    else navigateDay('prev');
  };
  const navNext = () => {
    if (isMonth) navigateMonth('next');
    else if (isWeek) navigateWeek('next');
    else navigateDay('next');
  };

  // Read fresh state inside the handler so the dep array is always [] (stable size)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      const { viewMode: vm, navigateDay: nd, navigateWeek: nw, navigateMonth: nm } = usePlannerStore.getState();
      if (e.key === 'ArrowLeft') {
        if (vm === 'month') nm('prev');
        else if (vm === 'week') nw('prev');
        else nd('prev');
      }
      if (e.key === 'ArrowRight') {
        if (vm === 'month') nm('next');
        else if (vm === 'week') nw('next');
        else nd('next');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // getState() always reads current state — no deps needed

  const atPresentUnit = isMonth ? thisMonth : isWeek ? thisWeek : todayFlag;

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-canvas)] flex-shrink-0">
      <div className="flex items-center justify-between px-6 py-2.5 min-h-[58px]">
        <div style={{ width: '25%' }} />

        <div className="flex items-center gap-2.5" style={{ width: '50%', justifyContent: 'center' }}>
          <button
            onClick={navPrev}
            className="ui-icon-button"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>

          <div className="flex items-center gap-2.5 min-w-[220px] justify-center">
            <span className="text-[1.15rem] font-bold tracking-tight text-[var(--color-text-primary)]" suppressHydrationWarning>
              {mounted ? (isMonth ? format(date, 'MMMM yyyy') : isWeek ? formatWeekRange(currentDate) : format(date, 'EEEE, MMMM d')) : ''}
            </span>
            {mounted && atPresentUnit && (
              <span className="px-2.5 py-1 rounded-full bg-[var(--color-accent-subtle)] text-[11px] font-semibold tracking-[0.08em] text-[var(--color-accent)]">
                {isMonth ? 'This month' : isWeek ? 'This week' : 'Today'}
              </span>
            )}
          </div>

          <button
            onClick={navNext}
            className="ui-icon-button"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>

          <button
            onClick={() => setCurrentDate(format(new Date(), 'yyyy-MM-dd'))}
            className={[
              'px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors',
              atPresentUnit
                ? 'invisible'
                : 'text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] cursor-pointer',
            ].join(' ')}
          >
            Today
          </button>
        </div>

        <div className="flex items-center justify-end gap-1.5" style={{ width: '25%' }}>
          {isMonth ? (
            <div className="flex items-center gap-2">
              {monthViewMode === 'tasks' && (
                <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                  {(['grid', 'expanded'] as const).map((mode) => {
                    const isActive = monthTaskLayout === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setMonthTaskLayout(mode)}
                        className={[
                          'px-2.5 py-1 rounded-full text-[11px] font-medium transition-all select-none cursor-pointer',
                          isActive
                            ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                        ].join(' ')}
                      >
                        {mode === 'grid' ? 'Grid' : 'Expanded'}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                {(['events', 'tasks'] as const).map((mode) => {
                  const isActive = monthViewMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setMonthViewMode(mode)}
                      className={[
                        'px-2.5 py-1 rounded-full text-[11px] font-medium transition-all select-none cursor-pointer',
                        isActive
                          ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                      ].join(' ')}
                    >
                      {mode === 'events' ? 'Events' : 'Tasks'}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="w-14" />
          )}
        </div>
      </div>
    </header>
  );
}
