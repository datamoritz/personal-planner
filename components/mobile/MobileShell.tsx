'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Moon, RefreshCw, Sparkles, Sun } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { endOfWeek, format, isSameMonth, parseISO, startOfWeek } from 'date-fns';
import { usePlannerStore } from '@/store/usePlannerStore';
import { TaskGhost, RecurrentGhost } from '@/components/dnd/DragGhost';
import { MobileDayView } from './MobileDayView';
import { MobileWeekView } from './MobileWeekView';
import { MobileMonthView } from './MobileMonthView';
import { MobileProjectsSheet } from './MobileProjectsSheet';
import { MobileCaptureBar } from './MobileCaptureBar';
import type { Task, RecurrentTask } from '@/types';

type ActiveDrag =
  | { type: 'task'; item: Task; compact?: boolean }
  | { type: 'recurrent'; item: RecurrentTask }
  | null;

interface MobileShellProps {
  theme: 'light' | 'dark';
  activeDrag: ActiveDrag;
  sensors: SensorDescriptor<SensorOptions>[];
  collisionDetection: CollisionDetection;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleRefresh: () => void;
}

const VIEW_TABS = [
  { label: 'Day',   value: 'day'   as const },
  { label: 'Week',  value: 'week'  as const },
  { label: 'Month', value: 'month' as const },
];

function formatHeaderDate(viewMode: string, currentDate: string, mounted: boolean): string {
  if (!mounted) return '';
  const date = parseISO(currentDate);
  if (viewMode === 'week') {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    const end = endOfWeek(date, { weekStartsOn: 1 });
    return isSameMonth(start, end)
      ? `${format(start, 'MMM d')} – ${format(end, 'd')}`
      : `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
  }
  if (viewMode === 'month') return format(date, 'MMMM yyyy');
  return format(date, 'EEE, MMM d');
}

export function MobileShell({
  theme,
  activeDrag,
  sensors,
  collisionDetection,
  handleDragStart,
  handleDragEnd,
  handleRefresh,
}: MobileShellProps) {
  const {
    viewMode, setViewMode,
    currentDate,
    navigateDay, navigateWeek, navigateMonth,
    setCurrentDate,
    toggleTheme,
    googleNeedsReconnect,
  } = usePlannerStore();

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureFocusToken, setCaptureFocusToken] = useState(0);

  // Clamp to the three views available on mobile
  const mobileView = (viewMode === 'day' || viewMode === 'week' || viewMode === 'month')
    ? viewMode
    : 'day';

  const navPrev = () => {
    if (mobileView === 'month') navigateMonth('prev');
    else if (mobileView === 'week') navigateWeek('prev');
    else navigateDay('prev');
  };
  const navNext = () => {
    if (mobileView === 'month') navigateMonth('next');
    else if (mobileView === 'week') navigateWeek('next');
    else navigateDay('next');
  };

  // Swipe left/right to navigate — cancelled if vertical scroll is detected first
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const headerTouchStartX = useRef<number | null>(null);
  const headerTouchStartY = useRef<number | null>(null);

  const openCapture = () => {
    setCaptureOpen(true);
    setCaptureFocusToken((token) => token + 1);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dy > dx && dy > 8) {
      touchStartX.current = null;
      touchStartY.current = null;
    }
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(deltaX) < 60) return;
    if (deltaX > 0) navPrev(); else navNext();
  };

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    headerTouchStartX.current = e.touches[0].clientX;
    headerTouchStartY.current = e.touches[0].clientY;
  };

  const handleHeaderTouchEnd = (e: React.TouchEvent) => {
    if (headerTouchStartX.current === null || headerTouchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - headerTouchStartX.current;
    const deltaY = e.changedTouches[0].clientY - headerTouchStartY.current;
    headerTouchStartX.current = null;
    headerTouchStartY.current = null;
    if (deltaY > 34 && Math.abs(deltaY) > Math.abs(deltaX) * 1.25) openCapture();
  };

  const dateLabel = formatHeaderDate(mobileView, currentDate, mounted);
  const isAtToday = mounted && mobileView === 'day' && currentDate === format(new Date(), 'yyyy-MM-dd');

  return (
    <div data-theme={theme} className="flex flex-col h-dvh bg-[var(--color-background)]">
      <DndContext
        id="mobile-planner-dnd"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Top header */}
        <header
          className="flex-shrink-0 flex items-center justify-between px-3 h-12 bg-[var(--color-canvas)] border-b border-[var(--color-border)]"
          onTouchStart={handleHeaderTouchStart}
          onTouchEnd={handleHeaderTouchEnd}
        >
          <button onClick={navPrev} className="ui-icon-button" aria-label="Previous">
            <ChevronLeft size={18} strokeWidth={2} />
          </button>

          <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
            <span
              className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)] truncate"
              suppressHydrationWarning
            >
              {dateLabel}
            </span>
            {mounted && !isAtToday && mobileView === 'day' && (
              <button
                type="button"
                onClick={() => setCurrentDate(format(new Date(), 'yyyy-MM-dd'))}
                className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
              >
                Today
              </button>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => captureOpen ? setCaptureOpen(false) : openCapture()}
              className={[
                'ui-icon-button',
                captureOpen ? 'ui-icon-button--accent' : '',
              ].join(' ')}
              aria-label={captureOpen ? 'Hide AI capture' : 'Show AI capture'}
              title={captureOpen ? 'Hide AI capture' : 'Show AI capture'}
            >
              <Sparkles size={14} strokeWidth={2.2} />
            </button>
            {googleNeedsReconnect ? (
              <button
                onClick={() => window.open('https://planner-api.moritzknodler.com/auth/google/login', '_blank')}
                className="ui-icon-button text-amber-500"
                aria-label="Reconnect Google Calendar"
                title="Reconnect Google Calendar"
              >
                <RefreshCw size={14} strokeWidth={2.2} />
              </button>
            ) : (
              <button onClick={handleRefresh} className="ui-icon-button" aria-label="Refresh">
                <RefreshCw size={14} strokeWidth={2} />
              </button>
            )}
            <button onClick={toggleTheme} className="ui-icon-button" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
            </button>
            <button onClick={navNext} className="ui-icon-button" aria-label="Next">
              <ChevronRight size={18} strokeWidth={2} />
            </button>
          </div>
        </header>

        {captureOpen && (
          <MobileCaptureBar
            autoFocusToken={captureFocusToken}
            onClose={() => setCaptureOpen(false)}
          />
        )}

        {/* Content area */}
        <main
          className="flex-1 min-h-0 overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {mobileView === 'day'   && <MobileDayView />}
          {mobileView === 'week'  && <MobileWeekView />}
          {mobileView === 'month' && <MobileMonthView />}
        </main>

        {/* Bottom tab bar */}
        <nav
          className="flex-shrink-0 flex bg-[var(--color-canvas)] border-t border-[var(--color-border)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {VIEW_TABS.map(({ label, value }) => {
            const isActive = mobileView === value && !sheetOpen;
            return (
              <button
                key={value}
                type="button"
                onClick={() => { setViewMode(value); setSheetOpen(false); }}
                className={[
                  'flex-1 py-4 text-[12px] transition-colors',
                  isActive ? 'font-semibold text-[var(--color-accent)]' : 'font-medium text-[var(--color-text-muted)]',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            className={[
              'flex-1 py-4 text-[12px] transition-colors',
              sheetOpen ? 'font-semibold text-[var(--color-accent)]' : 'font-medium text-[var(--color-text-muted)]',
            ].join(' ')}
          >
            More
          </button>
        </nav>

        {sheetOpen && <MobileProjectsSheet onClose={() => setSheetOpen(false)} />}

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'task' && <TaskGhost task={activeDrag.item} />}
          {activeDrag?.type === 'recurrent' && <RecurrentGhost task={activeDrag.item} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
