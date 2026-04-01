'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format, startOfWeek, addDays } from 'date-fns';
import { Plus } from 'lucide-react';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  usePlannerStore,
  selectMyDayTasks,
  selectCalendarEntriesForDate,
  selectGoogleCalendarEntriesForDate,
  selectGoogleAllDayEventsForDate,
  selectNextDayEarlyCalendarEntries,
  selectNextDayEarlyGoogleCalendarEntries,
  selectNextDayEarlyMyDayTasks,
} from '@/store/usePlannerStore';
import { CalendarEntryBlock } from '@/components/ui/CalendarEntryBlock';
import { TimedTaskBlock } from '@/components/ui/TimedTaskBlock';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { CalendarEntryDetailPopover } from '@/components/ui/CalendarEntryDetailPopover';
import { GoogleCalendarEntryDetailPopover } from '@/components/ui/GoogleCalendarEntryDetailPopover';
import { computeOverlapDepths } from '@/lib/overlapLayout';
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
import type { Task } from '@/types';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';

const TOTAL_HOURS        = END_HOUR;
const GRID_HEIGHT        = TOTAL_HOURS * SLOT_HEIGHT;
const DEFAULT_SCROLL_H   = 8;
const TIME_GUTTER_W      = 44;
const WEEK_OVERLAP_SHIFT = 10;
const DEFAULT_TASKS_H    = 130;
const MIN_TASKS_H        = 56;
const MAX_TASKS_H        = 320;

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

// ── Calendar day droppable zone (receives cross-column dnd-kit drops) ─────────
function CalendarDayDropZone({
  dateStr, dayColRef, className, onDoubleClick, children,
}: {
  dateStr: string;
  dayColRef: (el: HTMLDivElement | null) => void;
  className: string;
  onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: `week-cal-${dateStr}`,
    data: { containerId: 'week-cal' },
  });
  const combined = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    dayColRef(el);
  }, [setNodeRef, dayColRef]);
  return (
    <div ref={combined} className={className} onDoubleClick={onDoubleClick}>
      {children}
    </div>
  );
}

// ── Compact sortable task pill ────────────────────────────────────────────────
function WeekTaskItem({
  task, containerId, onToggle, onDoubleClick,
}: {
  task: Task;
  containerId: string;
  onToggle: (id: string) => void;
  onDoubleClick: (id: string, anchor: HTMLElement) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', containerId },
  });
  const isDone = task.status === 'done';
  const tags   = usePlannerStore((s) => s.tags);
  const tag    = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  const tagBg  = (!isDone && tag) ? tag.color + 'CC' : undefined;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform:  CSS.Transform.toString(transform),
        transition,
        opacity:    isDragging ? 0.4 : isDone ? 0.5 : 1,
        background: tagBg ?? (isDone ? 'var(--color-surface)' : 'var(--color-surface)'),
      }}
      {...attributes}
      {...listeners}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-grab select-none"
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(task.id, e.currentTarget); }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
        className={[
          'flex-shrink-0 w-3 h-3 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0',
          isDone ? 'bg-[var(--color-done)] border-[var(--color-done)]'
                 : 'border-[var(--color-text-muted)] hover:border-[var(--color-accent)]',
        ].join(' ')}
      >
        {isDone && (
          <svg width="5" height="4" viewBox="0 0 5 4" fill="none">
            <path d="M0.5 2L2 3.5L4.5 0.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span className={[
        'flex-1 min-w-0 truncate text-[11px] leading-tight',
        isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
      ].join(' ')}>
        {task.title}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
type Popover =
  | { type: 'task';  id: string; anchor: HTMLElement }
  | { type: 'entry'; id: string; anchor: HTMLElement }
  | { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean }
  | null;

interface WeekViewColumnProps { sidebarVisible: boolean; onNKey: () => void; }

export function WeekViewColumn({ sidebarVisible, onNKey }: WeekViewColumnProps) {
  const {
    currentDate, tasks, calendarEntries, googleCalendarEntries, googleAllDayEvents,
    setCurrentDate, setViewMode,
    toggleTask, addTask, addCalendarEntry,
    updateCalendarEntry, updateTask, moveTask, setGoogleCalendarEntries,
  } = usePlannerStore();
  const { refresh: refreshGoogle } = useGoogleCalendar();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const weekStart = startOfWeek(new Date(currentDate + 'T00:00:00'), { weekStartsOn: 1 });
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [todayStr, setTodayStr] = useState('');
  useEffect(() => { setTodayStr(format(new Date(), 'yyyy-MM-dd')); }, []);

  const scrollRef     = useRef<HTMLDivElement>(null);
  // Refs to each calendar day-column div — used for X-based day detection
  const dayColRefs    = useRef<Map<string, HTMLDivElement>>(new Map());

  const [tasksHeight, setTasksHeight] = useState(DEFAULT_TASKS_H);
  const [popover, setPopover]         = useState<Popover>(null);
  const [addingDay, setAddingDay]     = useState<string | null>(null);
  const [addValue, setAddValue]       = useState('');
  const [timeOffset, setTimeOffset]   = useState(getCurrentTimeOffset());
  const [timeLabel,  setTimeLabel]    = useState(getCurrentTimeLabel());

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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DEFAULT_SCROLL_H * SLOT_HEIGHT;
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      setTimeOffset(getCurrentTimeOffset());
      setTimeLabel(getCurrentTimeLabel());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sidebarVisible) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onNKey(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarVisible, onNKey]);

  // Stable ref callback per day-string
  const makeDayColRef = useCallback(
    (ds: string) => (el: HTMLDivElement | null) => {
      if (el) dayColRefs.current.set(ds, el);
      else    dayColRefs.current.delete(ds);
    },
    [],
  );

  // Given viewport clientX, return the date string of the day column it lands in
  const dateFromClientX = useCallback((clientX: number): string | null => {
    for (const [ds, el] of dayColRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return ds;
    }
    return null;
  }, []);

  // Given viewport clientY and current scrollTop, return the snapped time (minutes)
  const timeFromClientY = useCallback((clientY: number): number => {
    if (!scrollRef.current) return 0;
    const r   = scrollRef.current.getBoundingClientRect();
    const y   = clientY - r.top + scrollRef.current.scrollTop;
    return Math.max(0, Math.min(snapTo15Min((y / SLOT_HEIGHT) * 60), END_HOUR * 60 - 15));
  }, []);

  // Whether a viewport clientY is inside the calendar scroll area
  const isInCalendar = useCallback((clientY: number): boolean => {
    if (!scrollRef.current) return false;
    const r = scrollRef.current.getBoundingClientRect();
    return clientY >= r.top && clientY <= r.bottom;
  }, []);

  // ── dnd-kit monitor: handles drops onto calendar day droppables ───────────
  // weekAwareCollisionDetection in PlannerApp ensures `over` is week-cal-* whenever
  // the pointer is geometrically inside a calendar column, so case 1 is reliable.
  // Case 2 handles the rare edge where the pointer misses all droppables entirely.
  useDndMonitor({
    onDragEnd(event: DragEndEvent) {
      const { active, over } = event;

      // ── Case 1: pointer was inside a calendar column droppable ──
      if (over?.data.current?.containerId === 'week-cal') {
        const translated = active.rect.current.translated;
        if (!translated || !scrollRef.current) return;
        const cy         = translated.top + translated.height / 2;
        const targetDate = String(over.id).replace('week-cal-', '');
        const startMins  = timeFromClientY(cy);
        moveTask(String(active.id), {
          location:  'myday',
          date:       targetDate,
          startTime:  minutesToTime(startMins),
          endTime:    minutesToTime(startMins + 60),
        });
        return;
      }

      // ── Case 2: no droppable matched — fallback position check ──
      if (!over) {
        const sourceData  = active.data.current as { type?: string; containerId?: string } | undefined;
        const containerId = sourceData?.containerId ?? '';
        const eligible    = containerId.startsWith('week-today-')
          || containerId === 'backlog'
          || containerId === 'upcoming'
          || containerId.startsWith('project-');
        if (!eligible) return;

        const translated = active.rect.current.translated;
        if (!translated || !scrollRef.current) return;
        const cx = translated.left + translated.width  / 2;
        const cy = translated.top  + translated.height / 2;
        if (!isInCalendar(cy)) return;
        const targetDate = dateFromClientX(cx);
        if (!targetDate) return;
        const startMins = timeFromClientY(cy);
        moveTask(String(active.id), {
          location:  'myday',
          date:       targetDate,
          startTime:  minutesToTime(startMins),
          endTime:    minutesToTime(startMins + 60),
        });
      }
    },
  });

  // ── Tasks-section resize handle ───────────────────────────────────────────
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const cap = e.currentTarget as HTMLElement;
    cap.setPointerCapture(e.pointerId);
    const startY = e.clientY, initH = tasksHeight;
    const onMove = (ev: PointerEvent) =>
      setTasksHeight(Math.max(MIN_TASKS_H, Math.min(initH + (startY - ev.clientY), MAX_TASKS_H)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cap.releasePointerCapture(e.pointerId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);

  return (
    <div
      className="flex flex-col h-full overflow-hidden border-t-2 border-t-[var(--color-accent)]"
      style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
    >
      {/* Day header row */}
      <div className="flex flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-center-col)]">
        <div style={{ width: TIME_GUTTER_W, flexShrink: 0 }} />
        {weekDays.map((day) => {
          const ds = format(day, 'yyyy-MM-dd');
          const isToday = ds === todayStr;
          return (
            <div key={ds} className="flex-1 flex flex-col items-center py-1.5 border-l border-[var(--color-border-grid)]">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                {format(day, 'EEE')}
              </span>
              <button
                type="button"
                onClick={() => { setCurrentDate(ds); setViewMode('day'); }}
                title={`Open ${format(day, 'EEEE, MMMM d')}`}
                className={[
                  'w-6 h-6 flex items-center justify-center rounded-full text-[13px] font-semibold mt-0.5 transition-colors cursor-pointer',
                  isToday
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
                ].join(' ')}
              >
                {format(day, 'd')}
              </button>
            </div>
          );
        })}
      </div>

      {/* All-day events row — keep events, hide the left-side label */}
      {weekDays.some((d) => selectGoogleAllDayEventsForDate(googleAllDayEvents, format(d, 'yyyy-MM-dd')).length > 0) && (
        <div className="flex flex-shrink-0 border-b border-[var(--color-border)]">
          <div
            className="flex-shrink-0"
            style={{ width: TIME_GUTTER_W }}
            aria-hidden="true"
          />
          {weekDays.map((day) => {
            const ds     = format(day, 'yyyy-MM-dd');
            const events = selectGoogleAllDayEventsForDate(googleAllDayEvents, ds);
            return (
              <div key={ds} className="flex-1 flex flex-col gap-0.5 p-0.5 border-l border-[var(--color-border-grid)] min-w-0">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    title={ev.notes ?? ev.title}
                    className="px-1 py-0.5 rounded text-[10px] font-medium text-[#10b981] bg-[#10b981]/10 truncate select-none"
                  >
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Calendar grid — single shared scroll */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex" style={{ height: GRID_HEIGHT }}>

          {/* Time gutter */}
          <div className="flex-shrink-0 relative" style={{ width: TIME_GUTTER_W }}>
            {hours.map((h) => (
              <div key={h} className="absolute left-0 right-0 flex items-start pointer-events-none" style={{ top: h * SLOT_HEIGHT }}>
                <span className="w-full text-right pr-1.5 text-[9px] text-[var(--color-text-secondary)] leading-none -mt-[5px] select-none font-medium">
                  {h === 0 ? '' : formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {/* 7 day columns */}
          {weekDays.map((day) => {
            const ds           = format(day, 'yyyy-MM-dd');
            const isToday      = ds === todayStr;
            const now          = new Date();
            const isYesterday  = todayStr !== '' && (() => {
              const d = new Date(todayStr + 'T00:00:00');
              d.setDate(d.getDate() - 1);
              return ds === format(d, 'yyyy-MM-dd') && now.getHours() < 2;
            })();
            const isPastDay    = ds < todayStr && !isYesterday;

            const dayEntries          = selectCalendarEntriesForDate(calendarEntries, ds);
            const dayGoogleEntries    = selectGoogleCalendarEntriesForDate(googleCalendarEntries, ds);
            const dayTimedTasks       = selectMyDayTasks(tasks, ds).filter((t) => t.startTime && t.endTime);
            const dayOverflowEntries  = selectNextDayEarlyCalendarEntries(calendarEntries, ds);
            const dayOverflowGoogleEntries = selectNextDayEarlyGoogleCalendarEntries(googleCalendarEntries, ds);
            const dayOverflowTasks    = selectNextDayEarlyMyDayTasks(tasks, ds);

            const overlapItems = [
              ...dayEntries.map((e) => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
              ...dayGoogleEntries.map((e) => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
              ...dayTimedTasks.map((t) => ({ id: t.id, startTime: t.startTime!, endTime: t.endTime! })),
            ];
            const depths = computeOverlapDepths(overlapItems);

            const handleDayDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
              if ((e.target as HTMLElement) !== e.currentTarget) return;
              const rect    = e.currentTarget.getBoundingClientRect();
              const y       = e.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0);
              const snapped = snapTo15Min((y / SLOT_HEIGHT) * 60);
              const start   = minutesToTime(Math.max(0, Math.min(snapped, END_HOUR * 60 - 60)));
              addCalendarEntry({ title: 'New event', date: ds, startTime: start, endTime: minutesToTime(timeToMinutes(start) + 60) });
            };

            return (
              <CalendarDayDropZone
                key={ds}
                dateStr={ds}
                dayColRef={makeDayColRef(ds)}
                className="flex-1 relative border-l border-[var(--color-border-grid)] overflow-hidden"
                onDoubleClick={handleDayDoubleClick}
              >
                {hours.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-[var(--color-border-grid)] pointer-events-none" style={{ top: h * SLOT_HEIGHT }} />
                ))}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div key={`h-${i}`} className="absolute left-0 right-0 border-t border-dashed border-[var(--color-border-grid)] opacity-40 pointer-events-none" style={{ top: (i + 0.5) * SLOT_HEIGHT }} />
                ))}

                {isPastDay && (
                  <div className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                    style={{ height: GRID_HEIGHT, background: 'var(--color-past-overlay)' }} />
                )}
                {isYesterday && (
                  <div className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                    style={{ height: minutesToOffset(24 * 60 + now.getHours() * 60 + now.getMinutes()), background: 'var(--color-past-overlay)' }} />
                )}
                {isYesterday && (
                  <div
                    className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2"
                    style={{ top: minutesToOffset(24 * 60 + now.getHours() * 60 + now.getMinutes()) }}
                  >
                    <div className="bg-[#ff3b30] text-white text-[9px] font-bold px-1.5 h-4.5 flex items-center justify-center rounded-full shadow-sm z-50 select-none" style={{ marginLeft: '2px', minWidth: '34px' }}>
                      {getCurrentTimeLabel()}
                    </div>
                    <div className="flex-1 h-[1px] bg-[#ff3b30]" />
                  </div>
                )}
                {isToday && (
                  <div className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                    style={{ height: timeOffset, background: 'var(--color-past-overlay)' }} />
                )}
                {isToday && (
                  <div
                    className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2"
                    style={{ top: timeOffset }}
                  >
                    <div className="bg-[#ff3b30] text-white text-[9px] font-bold px-1.5 h-4.5 flex items-center justify-center rounded-full shadow-sm z-50 select-none" style={{ marginLeft: '2px', minWidth: '34px' }}>
                      {timeLabel}
                    </div>
                    <div className="flex-1 h-[1px] bg-[#ff3b30]" />
                  </div>
                )}

                {dayGoogleEntries.map((entry) => {
                  const depth = depths.get(entry.id) ?? 0;
                  return (
                    <CalendarEntryBlock
                      key={entry.id}
                      compact
                      readOnly
                      entry={entry}
                      style={{ top: minutesToOffset(timeToMinutes(entry.startTime)) + 1, height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 20), left: depth * WEEK_OVERLAP_SHIFT, right: 2, zIndex: 5 + depth }}
                      onDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
                      onResizeEnd={(id, t) => updateGoogleEntry(id, { date: ds, endTime: t })}
                      onRepositionEnd={(id, s, en, pos) => {
                        const targetDate = pos ? (dateFromClientX(pos.x) ?? ds) : ds;
                        updateGoogleEntry(id, { date: targetDate, startTime: s, endTime: en });
                      }}
                    />
                  );
                })}

                {dayEntries.map((entry) => {
                  const depth = depths.get(entry.id) ?? 0;
                  return (
                    <CalendarEntryBlock
                      key={entry.id}
                      compact
                      entry={entry}
                      style={{ top: minutesToOffset(timeToMinutes(entry.startTime)) + 1, height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 20), left: depth * WEEK_OVERLAP_SHIFT, right: 2, zIndex: 5 + depth }}
                      onDoubleClick={(id, anchor) => setPopover({ type: 'entry', id, anchor })}
                      onResizeEnd={(id, t) => updateCalendarEntry(id, { endTime: t })}
                      onRepositionEnd={(id, s, en, pos) => {
                        const targetDate = pos ? (dateFromClientX(pos.x) ?? entry.date) : entry.date;
                        if (targetDate === entry.date) {
                          updateCalendarEntry(id, { startTime: s, endTime: en });
                        } else {
                          // Move to new date — rebuild via delete+add since updateCalendarEntry doesn't support date
                          const { deleteCalendarEntry, addCalendarEntry: addEntry } = usePlannerStore.getState();
                          deleteCalendarEntry(id);
                          addEntry({ title: entry.title, date: targetDate, startTime: s, endTime: en });
                        }
                      }}
                    />
                  );
                })}

                {dayTimedTasks.map((task) => {
                  const depth = depths.get(task.id) ?? 0;
                  return (
                    <TimedTaskBlock
                      key={task.id}
                      compact
                      task={task}
                      style={{ top: minutesToOffset(timeToMinutes(task.startTime!)) + 1, height: Math.max(durationToHeight(task.startTime!, task.endTime!) - 2, 20), left: depth * WEEK_OVERLAP_SHIFT, right: 2, zIndex: 5 + depth }}
                      onToggle={toggleTask}
                      onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                      onResizeEnd={(id, t) => updateTask(id, { endTime: t })}
                      onRepositionEnd={(id, s, en, pos) => {
                        if (!pos) { updateTask(id, { startTime: s, endTime: en }); return; }
                        if (!isInCalendar(pos.y)) {
                          const dayAtX = dateFromClientX(pos.x);
                          if (dayAtX) {
                            moveTask(id, { location: 'today', date: dayAtX });
                          } else {
                            moveTask(id, { location: 'backlog', date: undefined });
                          }
                          return;
                        }
                        const targetDate = dateFromClientX(pos.x) ?? task.date!;
                        if (targetDate === task.date) {
                          updateTask(id, { startTime: s, endTime: en });
                        } else {
                          moveTask(id, { location: 'myday', date: targetDate, startTime: s, endTime: en });
                        }
                      }}
                    />
                  );
                })}

                {/* Overflow zone: next-day 00:00–01:59 items at 24:xx */}
                {dayOverflowEntries.map((entry) => (
                  <CalendarEntryBlock
                    key={`overflow-${entry.id}`}
                    entry={entry}
                    compact
                    readOnly
                    style={{ top: minutesToOffset(24 * 60 + timeToMinutes(entry.startTime)) + 1, height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 20), left: 0, right: 2, zIndex: 4, opacity: 0.7 }}
                  />
                ))}

                {dayOverflowGoogleEntries.map((entry) => (
                  <CalendarEntryBlock
                    key={`overflow-google-${entry.id}`}
                    entry={entry}
                    compact
                    readOnly
                    style={{ top: minutesToOffset(24 * 60 + timeToMinutes(entry.startTime)) + 1, height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 20), left: 0, right: 2, zIndex: 4, opacity: 0.7 }}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
                    onResizeEnd={(id, t) => updateGoogleEntry(id, { date: ds, endTime: t })}
                    onRepositionEnd={(id, s, en, pos) => {
                      const targetDate = pos ? (dateFromClientX(pos.x) ?? ds) : ds;
                      updateGoogleEntry(id, { date: targetDate, startTime: s, endTime: en });
                    }}
                  />
                ))}

                {dayOverflowTasks.map((task) => (
                  <TimedTaskBlock
                    key={`overflow-${task.id}`}
                    compact
                    task={task}
                    style={{ top: minutesToOffset(24 * 60 + timeToMinutes(task.startTime!)) + 1, height: Math.max(durationToHeight(task.startTime!, task.endTime!) - 2, 20), left: 0, right: 2, zIndex: 4, opacity: 0.7 }}
                    onToggle={toggleTask}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                    onResizeEnd={(id, t) => updateTask(id, { endTime: t })}
                    onRepositionEnd={(id, s, en) => updateTask(id, { startTime: s, endTime: en })}
                  />
                ))}
              </CalendarDayDropZone>
            );
          })}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onPointerDown={handleResizePointerDown}
        className="flex-shrink-0 h-2 flex items-center justify-center border-t border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-row-resize group"
      >
        <div className="w-8 h-0.5 rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-accent)] transition-colors" />
      </div>

      {/* Tasks section */}
      <div className="flex flex-shrink-0 border-t border-[var(--color-border)]" style={{ height: tasksHeight }}>
        <div className="flex-shrink-0 flex items-start justify-end pt-1.5 pr-1" style={{ width: TIME_GUTTER_W }}>
          <span className="text-[8px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">Tasks</span>
        </div>

        {weekDays.map((day) => {
          const ds       = format(day, 'yyyy-MM-dd');
          const cId      = `week-today-${ds}`;
          const dayTasks = tasks.filter((t) => t.date === ds && (t.location === 'today' || t.location === 'upcoming'));
          const isAdding = addingDay === ds;

          return (
            <div key={ds} className="flex-1 flex flex-col border-l border-[var(--color-border-grid)] overflow-hidden min-w-0">
              <div className="flex items-center justify-end px-1 pt-1 flex-shrink-0">
                <button
                  onClick={() => { setAddingDay(ds); setAddValue(''); }}
                  title={`Add task for ${format(day, 'EEE')}`}
                  className="w-4 h-4 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
                >
                  <Plus size={10} strokeWidth={2.5} />
                </button>
              </div>

              <DroppableSection
                containerId={cId}
                itemIds={dayTasks.map((t) => t.id)}
                className="flex-1 overflow-y-auto px-1 pb-1 flex flex-col gap-0.5 min-h-0"
              >
                {dayTasks.map((task) => (
                  <WeekTaskItem
                    key={task.id}
                    task={task}
                    containerId={cId}
                    onToggle={toggleTask}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                  />
                ))}
                {isAdding && (
                  <input
                    autoFocus
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { const t = addValue.trim(); if (t) addTask({ title: t, location: 'today', date: ds }); setAddingDay(null); }
                      else if (e.key === 'Escape') setAddingDay(null);
                    }}
                    onBlur={() => { const t = addValue.trim(); if (t) addTask({ title: t, location: 'today', date: ds }); setAddingDay(null); }}
                    placeholder="Task…"
                    className="w-full px-1.5 py-0.5 rounded-full border border-dashed border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
                  />
                )}
              </DroppableSection>
            </div>
          );
        })}
      </div>

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.type === 'entry' && (
        <CalendarEntryDetailPopover entryId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.type === 'google-entry' && (
        <GoogleCalendarEntryDetailPopover entryId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} isDraft={popover.isDraft} />
      )}
    </div>
  );
}
