'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDndMonitor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { addDays, format } from 'date-fns';
import {
  usePlannerStore,
  selectMyDayTasks,
  selectGoogleCalendarEntriesForDate,
  selectGoogleAllDayEventsForDate,
  selectNextDayEarlyGoogleCalendarEntries,
  selectNextDayEarlyMyDayTasks,
} from '@/store/usePlannerStore';
import { AllDayStrip } from '@/components/ui/AllDayStrip';
import { CalendarEntryBlock } from '@/components/ui/CalendarEntryBlock';
import { DraggableTimedTaskBlock } from '@/components/dnd/DraggableTimedTaskBlock';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { GoogleCalendarEntryDetailPopover } from '@/components/ui/GoogleCalendarEntryDetailPopover';
import { UncertaintyNotepad } from '@/components/ui/UncertaintyNotepad';
import { CalendarDays, Maximize2, Minimize2, Sparkles, StickyNote } from 'lucide-react';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToTime,
  minutesToOffset,
  durationToHeight,
  snapTo15Min,
  normalizeGridEventRange,
} from '@/lib/timeGrid';
import { computeOverlapDepths } from '@/lib/overlapLayout';
import type { OverlapItem } from '@/lib/overlapLayout';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';

const TOTAL_HOURS      = END_HOUR;
const GRID_HEIGHT      = TOTAL_HOURS * SLOT_HEIGHT;
const DEFAULT_SCROLL_H = 8;
const LEFT_BASE        = 52;
const OVERLAP_SHIFT    = 14;

function getCurrentTimeOffset() {
  const now = new Date();
  return minutesToOffset(now.getHours() * 60 + now.getMinutes());
}

function getCurrentTimeLabel() {
  const now = new Date();
  const h = now.getHours() % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatHour(h: number) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h === 24) return '+12 AM';
  if (h === 25) return '+1 AM';
  if (h === 26) return '+2 AM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

type TaskPopover  = { type: 'task';  id: string; anchor: HTMLElement };
type GoogleEntryPopover = { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean };
type PopoverState = TaskPopover | GoogleEntryPopover | null;

function createClickAnchor(x: number, y: number): HTMLElement {
  const anchor = document.createElement('div');
  anchor.style.position = 'fixed';
  anchor.style.left = `${x}px`;
  anchor.style.top = `${y}px`;
  anchor.style.width = '1px';
  anchor.style.height = '1px';
  anchor.style.pointerEvents = 'none';
  anchor.style.opacity = '0';
  anchor.dataset.popoverAnchor = 'temporary';
  document.body.appendChild(anchor);
  return anchor;
}

export function MyDayColumn({ onFocusMode, onActionsMode }: { onFocusMode?: (active: boolean) => void; onActionsMode?: (active: boolean) => void }) {
  const {
    currentDate, tasks, googleCalendarEntries, googleAllDayEvents,
    toggleTask,
    updateTask, moveTask, setGoogleCalendarEntries, setViewMode,
  } = usePlannerStore();
  const { refresh: refreshGoogle } = useGoogleCalendar();

  const [notepadOpen, setNotepadOpen]     = useState(false);
  const [actionsMode, setActionsMode]     = useState(false);
  const [focusMode, setFocusMode]         = useState(false);

  const toggleNotepad = () => {
    const next = !notepadOpen;
    setNotepadOpen(next);
    if (!next) { setActionsMode(false); setFocusMode(false); onFocusMode?.(false); onActionsMode?.(false); }
  };
  const toggleFocus = () => {
    const next = !focusMode;
    setFocusMode(next);
    onFocusMode?.(next);
  };

  const timedTasks    = selectMyDayTasks(tasks, currentDate);
  const googleEntries = selectGoogleCalendarEntriesForDate(googleCalendarEntries, currentDate);
  const allDayEvents  = selectGoogleAllDayEventsForDate(googleAllDayEvents, currentDate);
  const overflowGoogleEntries = selectNextDayEarlyGoogleCalendarEntries(googleCalendarEntries, currentDate);
  const overflowTasks     = selectNextDayEarlyMyDayTasks(tasks, currentDate);
  const [today, setToday] = useState('');
  useEffect(() => { setToday(format(new Date(), 'yyyy-MM-dd')); }, []);
  const isToday     = today !== '' && currentDate === today;
  const isYesterday = today !== '' && (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return currentDate === format(d, 'yyyy-MM-dd') && new Date().getHours() < 2;
  })();

  const [timeOffset, setTimeOffset] = useState<number | null>(isToday ? getCurrentTimeOffset() : null);
  const [timeLabel,  setTimeLabel]  = useState<string>(isToday ? getCurrentTimeLabel() : '');
  const [popover, setPopover]       = useState<PopoverState>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const closePopover = useCallback(() => {
    setPopover((current) => {
      if (current?.anchor.dataset.popoverAnchor === 'temporary') {
        current.anchor.remove();
      }
      return null;
    });
  }, []);

  const updateGoogleEntry = useCallback((entryId: string, updates: { date?: string; startTime?: string; endTime?: string; title?: string; notes?: string }) => {
    const prevEntries = usePlannerStore.getState().googleCalendarEntries;
    const entry = prevEntries.find((e) => e.id === entryId);
    if (!entry) return;

    const nextDate = updates.date ?? entry.date;
    const nextStart = updates.startTime ?? entry.startTime;
    const nextEnd = updates.endTime ?? entry.endTime;
    const nextTitle = updates.title ?? entry.title;
    const nextNotes = updates.notes ?? entry.notes;
    const normalizedRange = normalizeGridEventRange(nextDate, nextStart, nextEnd);
    const optimisticEntry = {
      ...entry,
      title: nextTitle,
      date: nextDate,
      startTime: nextStart,
      endTime: nextEnd,
      notes: nextNotes,
    };

    setGoogleCalendarEntries(
      prevEntries.map((e) => (e.id === entryId ? optimisticEntry : e))
    );

    api.patchGoogleTimedEvent(entry.id.split('::')[0], {
      title: nextTitle,
      date: normalizedRange.startDate,
      endDate: normalizedRange.endDate,
      startTime: normalizedRange.startTime,
      endTime: normalizedRange.endTime,
      notes: nextNotes,
      tz,
    }).then(() => {
      refreshGoogle();
    }).catch((err) => {
      console.error('[patchGoogleTimedEvent]', err);
      setGoogleCalendarEntries(prevEntries);
    });
  }, [refreshGoogle, setGoogleCalendarEntries, tz]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const setRef = useCallback((el: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DEFAULT_SCROLL_H * SLOT_HEIGHT;
  }, []);

  useEffect(() => {
    if (!isToday) { setTimeOffset(null); setTimeLabel(''); return; }
    setTimeOffset(getCurrentTimeOffset());
    setTimeLabel(getCurrentTimeLabel());
    const id = setInterval(() => {
      setTimeOffset(getCurrentTimeOffset());
      setTimeLabel(getCurrentTimeLabel());
    }, 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  useDndMonitor({
    onDragEnd(event: DragEndEvent) {
      const { active, over } = event;
      const sourceData = active.data.current as { type?: string; containerId?: string } | undefined;
      if (sourceData?.type === 'recurrent') return;

      const translated = active.rect.current.translated;
      if (!translated || !scrollRef.current) return;

      const gridRect = scrollRef.current.getBoundingClientRect();
      const centerX  = translated.left + translated.width  / 2;
      const centerY  = translated.top  + translated.height / 2;
      const inGrid   = centerX >= gridRect.left && centerX <= gridRect.right
                    && centerY >= gridRect.top  && centerY <= gridRect.bottom;

      if (sourceData?.containerId === 'myday') {
        // Task being repositioned within My Day grid — only handle if dropped in grid
        // and not claimed by another droppable (e.g. Tasks Today column)
        if (over) return; // another droppable handled it (e.g. Tasks Today)
        if (!inGrid) return;
        const task     = usePlannerStore.getState().tasks.find((t) => t.id === String(active.id));
        const duration = task?.startTime && task?.endTime
          ? timeToMinutes(task.endTime) - timeToMinutes(task.startTime)
          : 60;
        const dropY     = centerY - gridRect.top + scrollRef.current.scrollTop;
        const snapped   = snapTo15Min((dropY / SLOT_HEIGHT) * 60);
        const startMins = Math.max(0, Math.min(snapped, END_HOUR * 60 - duration));
        moveTask(String(active.id), {
          location:  'myday',
          date:       currentDate,
          startTime:  minutesToTime(startMins),
          endTime:    minutesToTime(startMins + duration),
        });
        return;
      }

      // External task dropped into My Day grid
      if (!inGrid) return;
      const dropY     = centerY - gridRect.top + scrollRef.current.scrollTop;
      const snapped   = snapTo15Min((dropY / SLOT_HEIGHT) * 60);
      const startMins = Math.max(0, Math.min(snapped, END_HOUR * 60 - 60));
      moveTask(String(active.id), {
        location:  'myday',
        date:       currentDate,
        startTime:  minutesToTime(startMins),
        endTime:    minutesToTime(startMins + 60),
      });
    },
  });

  const handleGridDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    const y       = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const snapped = snapTo15Min((y / SLOT_HEIGHT) * 60);
    const startMinutes = Math.max(0, Math.min(snapped, END_HOUR * 60 - 60));
    const endMinutes = startMinutes + 60;
    const baseDate = new Date(`${currentDate}T00:00:00`);
    const startDate = startMinutes >= 24 * 60 ? addDays(baseDate, 1) : baseDate;
    const endDate = endMinutes >= 24 * 60 ? addDays(baseDate, 1) : baseDate;
    const start = minutesToTime(startMinutes % (24 * 60));
    const end = minutesToTime(endMinutes % (24 * 60));
    api.createGoogleTimedEvent({
      title: 'New event',
      date: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
      startTime: start,
      endTime: end,
      tz,
    }).then((created) => {
      setGoogleCalendarEntries([...googleCalendarEntries, created]);
      setPopover({
        type: 'google-entry',
        id: created.id,
        anchor: createClickAnchor(e.clientX, e.clientY),
        isDraft: true,
      });
      refreshGoogle();
    }).catch((err) => {
      console.error('[createGoogleTimedEvent]', err);
    });
  };

  const overlapItems: OverlapItem[] = [
    ...googleEntries.map(e => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    ...timedTasks.filter(t => t.startTime && t.endTime).map(t => ({ id: t.id, startTime: t.startTime!, endTime: t.endTime! })),
  ];
  const depths = computeOverlapDepths(overlapItems);

  // Overflow items render in the 24:xx zone — offset their minutes by +24h
  function overflowTop(startTime: string) {
    return minutesToOffset(24 * 60 + timeToMinutes(startTime)) + 1;
  }
  function overflowHeight(startTime: string, endTime: string) {
    return Math.max(durationToHeight(startTime, endTime) - 2, 24);
  }
  const hours  = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-[var(--color-border)]">
      {/* Header */}
      <div
        className={[
          'flex h-[52px] items-center justify-between px-4 border-b border-[var(--color-border)] flex-shrink-0 transition-colors',
          notepadOpen ? 'bg-[#fff7c7]' : '',
        ].join(' ')}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {notepadOpen ? 'What is uncertain?' : 'My Day'}
        </h2>
        <div className="flex items-center gap-1">
          {!notepadOpen && (
            <button
              onClick={() => setViewMode('week')}
              title="Switch to week view"
              className="ui-icon-button text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <CalendarDays size={14} strokeWidth={2} />
            </button>
          )}
          {notepadOpen && (
            <>
              <button
                onClick={() => { const next = !actionsMode; setActionsMode(next); onActionsMode?.(next); }}
                title={actionsMode ? 'Hide action tools' : 'Show action tools'}
                className={[
                  'w-7 h-7 flex items-center justify-center rounded-xl transition-colors cursor-pointer',
                  actionsMode
                    ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
                ].join(' ')}
              >
                <Sparkles size={13} strokeWidth={2} />
              </button>
              <button
                onClick={toggleFocus}
                title={focusMode ? 'Exit focus mode' : 'Focus mode'}
                className={[
                  'w-7 h-7 flex items-center justify-center rounded-xl transition-colors cursor-pointer',
                  focusMode
                    ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
                ].join(' ')}
              >
                {focusMode ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
              </button>
            </>
          )}
          <button
            onClick={toggleNotepad}
            title={notepadOpen ? 'Back to My Day' : 'What is uncertain?'}
            className={[
              'w-7 h-7 flex items-center justify-center rounded-xl transition-colors cursor-pointer',
              notepadOpen
                ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
            ].join(' ')}
          >
            <StickyNote size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* All-day events strip — only when not in notepad mode */}
      {!notepadOpen && <AllDayStrip events={allDayEvents} />}

      {/* Notepad mode */}
      {notepadOpen && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#fffbe0]">
          <UncertaintyNotepad actionsVisible={actionsMode} />
        </div>
      )}

      {/* Calendar grid */}
      {!notepadOpen && <div ref={setRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="relative" style={{ height: GRID_HEIGHT }} onDoubleClick={handleGridDoubleClick}>

            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start pointer-events-none"
                style={{ top: hour * SLOT_HEIGHT }}
              >
                <span className="w-12 text-right pr-3 text-[10px] text-[var(--color-text-secondary)] leading-none -mt-[6px] flex-shrink-0 select-none font-medium">
                  {formatHour(hour)}
                </span>
                <div className="flex-1 border-t border-[var(--color-border-grid)]" />
              </div>
            ))}

            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={`half-${i}`}
                className="absolute left-12 right-0 border-t border-dashed border-[var(--color-border-grid)] opacity-50 pointer-events-none"
                style={{ top: (i + 0.5) * SLOT_HEIGHT }}
              />
            ))}

            {/* Past tint */}
            {isYesterday && (
              <div
                className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                style={{
                  height: minutesToOffset(24 * 60 + new Date().getHours() * 60 + new Date().getMinutes()),
                  background: 'var(--color-past-overlay)',
                }}
              />
            )}
            {timeOffset !== null && !isYesterday && (
              <div
                className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                style={{ height: timeOffset, background: 'var(--color-past-overlay)' }}
              />
            )}

            {/* Red line */}
            {isYesterday && (() => {
              const overflowOffset = minutesToOffset(24 * 60 + new Date().getHours() * 60 + new Date().getMinutes());
              return (
                <div
                  className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2"
                  style={{ top: overflowOffset }}
                >
                  <div className="bg-[#ff3b30] text-white text-[10px] font-bold px-1.5 h-5 flex items-center justify-center rounded-full shadow-sm z-50 select-none" style={{ marginLeft: '2px', minWidth: '38px' }}>
                    {getCurrentTimeLabel()}
                  </div>
                  <div className="flex-1 h-[1px] bg-[#ff3b30]" />
                </div>
              );
            })()}
            {timeOffset !== null && !isYesterday && (
              <div
                className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2"
                style={{ top: timeOffset }}
              >
                <div
                  className="bg-[#ff3b30] text-white text-[10px] font-bold px-1.5 h-5 flex items-center justify-center rounded-full shadow-sm z-50 select-none"
                  style={{ marginLeft: '2px', minWidth: '38px' }}
                >
                  {timeLabel}
                </div>
                <div className="flex-1 h-[1px] bg-[#ff3b30]" />
              </div>
            )}

            {googleEntries.map((entry) => {
              const depth = depths.get(entry.id) ?? 0;
              return (
                <CalendarEntryBlock
                  key={entry.id}
                  entry={entry}
                  readOnly
                  style={{
                    top:    minutesToOffset(timeToMinutes(entry.startTime)) + 1,
                    height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 24),
                    left:   LEFT_BASE + depth * OVERLAP_SHIFT,
                    right:  4,
                    zIndex: 5 + depth,
                  }}
                  verticalOnly
                  onDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
                  onResizeEnd={(id, t) => updateGoogleEntry(id, { date: currentDate, endTime: t })}
                  onRepositionEnd={(id, s, e) => updateGoogleEntry(id, { date: currentDate, startTime: s, endTime: e })}
                />
              );
            })}

            {timedTasks.map((task) => {
              const depth = depths.get(task.id) ?? 0;
              return (
                <DraggableTimedTaskBlock
                  key={task.id}
                  task={task}
                  style={{
                    top:    task.startTime ? minutesToOffset(timeToMinutes(task.startTime)) + 1 : 0,
                    height: task.startTime && task.endTime
                      ? Math.max(durationToHeight(task.startTime, task.endTime) - 2, 24)
                      : SLOT_HEIGHT - 2,
                    left:   LEFT_BASE + depth * OVERLAP_SHIFT,
                    right:  4,
                    zIndex: 5 + depth,
                  }}
                  onToggle={toggleTask}
                  verticalOnly
                  onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                  onResizeEnd={(id, t) => updateTask(id, { endTime: t })}
                  onRepositionEnd={(id, s, e) => updateTask(id, { startTime: s, endTime: e })}
                />
              );
            })}

            {/* Overflow zone: next-day 00:00–01:59 items rendered at 24:xx–25:59 */}
            {overflowGoogleEntries.map((entry) => (
              <CalendarEntryBlock
                key={`overflow-google-${entry.id}`}
                entry={entry}
                readOnly
                style={{
                  top:    overflowTop(entry.startTime),
                  height: overflowHeight(entry.startTime, entry.endTime),
                  left:   LEFT_BASE,
                  right:  4,
                  zIndex: 4,
                  opacity: 0.7,
                }}
                verticalOnly
                onDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
                onResizeEnd={(id, t) => updateGoogleEntry(id, { date: currentDate, endTime: t })}
                onRepositionEnd={(id, s, e) => updateGoogleEntry(id, { date: currentDate, startTime: s, endTime: e })}
              />
            ))}

            {overflowTasks.map((task) => (
              <DraggableTimedTaskBlock
                key={`overflow-${task.id}`}
                task={task}
                style={{
                  top:    task.startTime ? overflowTop(task.startTime) : 0,
                  height: task.startTime && task.endTime
                    ? overflowHeight(task.startTime, task.endTime)
                    : SLOT_HEIGHT - 2,
                  left:   LEFT_BASE,
                  right:  4,
                  zIndex: 4,
                  opacity: 0.7,
                }}
                onToggle={toggleTask}
                verticalOnly
                onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                onResizeEnd={(id, t) => updateTask(id, { endTime: t })}
                onRepositionEnd={(id, s, e) => updateTask(id, { startTime: s, endTime: e })}
              />
            ))}
          </div>
      </div>}

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={closePopover} />
      )}
      {popover?.type === 'google-entry' && (
        <GoogleCalendarEntryDetailPopover entryId={popover.id} anchor={popover.anchor} onClose={closePopover} isDraft={popover.isDraft} />
      )}
    </div>
  );
}
