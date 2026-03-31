'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Moon, RefreshCw, Sun, Tag } from 'lucide-react';
import { format, isToday, parseISO, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';
import { usePlannerStore } from '@/store/usePlannerStore';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { TagsDropdown } from '@/components/ui/TagsDropdown';
import { DetailPopover } from '@/components/ui/DetailPopover';

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

export function DayHeader({ onRefreshGoogle }: { onRefreshGoogle?: () => void }) {
  const {
    currentDate, navigateDay, navigateWeek, setCurrentDate,
    theme, toggleTheme, viewMode, setViewMode,
    tags, activeTagFilter, googleNeedsReconnect,
  } = usePlannerStore();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tagsOpen, setTagsOpen] = useState(false);
  const tagsAnchorRef = useRef<HTMLButtonElement>(null);

  const date       = parseISO(currentDate);
  const todayFlag  = mounted && isToday(date);
  const isWeek     = viewMode === 'week';
  const thisWeek   = mounted && isCurrentWeek(currentDate);

  const navPrev = () => isWeek ? navigateWeek('prev') : navigateDay('prev');
  const navNext = () => isWeek ? navigateWeek('next') : navigateDay('next');

  // Read fresh state inside the handler so the dep array is always [] (stable size)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      const { viewMode: vm, navigateDay: nd, navigateWeek: nw } = usePlannerStore.getState();
      if (e.key === 'ArrowLeft')  vm === 'week' ? nw('prev') : nd('prev');
      if (e.key === 'ArrowRight') vm === 'week' ? nw('next') : nd('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // getState() always reads current state — no deps needed

  const atPresentUnit = isWeek ? thisWeek : todayFlag;

const activeTag = tags.find((t) => t.id === activeTagFilter);

const activeTagStyle = activeTag ? {
  backgroundColor: activeTag.color,
  color: activeTag.colorDark,
  borderColor: activeTag.colorDark,
} : {};

  return (
    <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)] flex-shrink-0 bg-[var(--color-canvas)]">
      {/* Left — brand + view toggle + tags */}
      <div className="flex items-center gap-3" style={{ width: '23%' }}>
        <span className="text-sm font-bold tracking-tight text-[var(--color-text-primary)] flex-shrink-0">
          Planner
        </span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
        {/* Tags button */}
        <div className="relative flex-shrink-0">
          <button
            ref={tagsAnchorRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTagsOpen((v) => !v);
            }}
            // Add the style line here:
            style={activeTagFilter !== null ? activeTagStyle : {}}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer select-none outline-none border border-transparent',
              activeTagFilter === null
                ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
                : '',
            ].join(' ')}
          >
            <Tag
              size={13}
              strokeWidth={2.5}
              color={activeTagFilter !== null ? activeTag?.colorDark : 'currentColor'}
            />
            {activeTagFilter !== null ? activeTag?.name : 'Tags'}
          </button>
          {tagsOpen && tagsAnchorRef.current && (
            <DetailPopover anchor={tagsAnchorRef.current} onClose={() => setTagsOpen(false)} className="w-auto" noPadding>
              <TagsDropdown onClose={() => setTagsOpen(false)} />
            </DetailPopover>
          )}
        </div>
      </div>

      {/* Center — date navigation */}
      <div className="flex items-center gap-2" style={{ width: '54%', justifyContent: 'center' }}>
        <button
          onClick={navPrev}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>

        <div className="flex items-center gap-2.5 min-w-[220px] justify-center">
          <span className="text-base font-bold text-[var(--color-text-primary)]" suppressHydrationWarning>
            {mounted ? (isWeek ? formatWeekRange(currentDate) : format(date, 'EEEE, MMMM d')) : ''}
          </span>
          {mounted && atPresentUnit && (
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
              {isWeek ? 'This week' : 'Today'}
            </span>
          )}
        </div>

        <button
          onClick={navNext}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>

        <button
          onClick={() => setCurrentDate(format(new Date(), 'yyyy-MM-dd'))}
          className={[
            'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
            atPresentUnit
              ? 'invisible'
              : 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)] hover:bg-[var(--color-accent)] hover:text-white cursor-pointer',
          ].join(' ')}
        >
          Today
        </button>
      </div>

      {/* Right — refresh Google + theme toggle */}
      <div className="flex items-center justify-end gap-1" style={{ width: '23%' }}>
        {googleNeedsReconnect ? (
          <button
            onClick={() => window.open('https://planner-api.moritzknodler.com/auth/google/login', '_blank')}
            title="Reconnect Google Calendar"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-400 transition-colors cursor-pointer"
          >
            <RefreshCw size={11} strokeWidth={2.5} />
            Reconnect
          </button>
        ) : onRefreshGoogle && (
          <button
            onClick={onRefreshGoogle}
            title="Refresh Google Calendar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[#10b981] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
          >
            <RefreshCw size={14} strokeWidth={2} />
          </button>
        )}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
        </button>
      </div>
    </header>
  );
}
