'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format, startOfWeek, addDays } from 'date-fns';
import { useDndMonitor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  usePlannerStore,
  selectMyDayTasks,
  selectGoogleCalendarEntriesForDate,
  selectMergedGoogleCalendarEntryById,
  selectNextDayEarlyGoogleCalendarEntries,
  selectNextDayEarlyMyDayTasks,
} from '@/store/usePlannerStore';
import { computeOverlapDepths } from '@/lib/overlapLayout';
import {
  END_HOUR,
  SLOT_HEIGHT,
  minutesToTime,
  minutesToOffset,
  snapTo15Min,
  normalizeGridEventRange,
} from '@/lib/timeGrid';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { WeekViewColumnView } from './WeekViewColumnView';

const DEFAULT_SCROLL_H   = 8;
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
// ── Main component ────────────────────────────────────────────────────────────
type Popover =
  | { type: 'task';  id: string; anchor: HTMLElement }
  | { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean }
  | null;

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

interface WeekViewColumnProps { sidebarVisible: boolean; onNKey: () => void; }

export function WeekViewColumn({ sidebarVisible, onNKey }: WeekViewColumnProps) {
  const {
    currentDate, tasks, googleCalendarEntries, googleAllDayEvents,
    setCurrentDate, setViewMode,
    toggleTask, addTask,
    updateTask, moveTask, applyOptimisticGoogleEntry, clearPendingGoogleMutation, setGoogleCalendarEntries,
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
    const entry = selectMergedGoogleCalendarEntryById(prevEntries, entryId);
    if (!entry) return;

    const nextDate = updates.date ?? entry.startDate ?? entry.date;
    const nextStart = updates.startTime ?? entry.startTime;
    const nextEnd = updates.endTime ?? entry.endTime;
    const nextTitle = updates.title ?? entry.title;
    const nextNotes = updates.notes ?? entry.notes;
    const normalizedRange = normalizeGridEventRange(nextDate, nextStart, nextEnd);
    const optimisticEntry = {
      ...entry,
      title: nextTitle,
      startDate: normalizedRange.startDate,
      endDate: normalizedRange.endDate,
      date: normalizedRange.startDate,
      startTime: normalizedRange.startTime,
      endTime: normalizedRange.endTime,
      notes: nextNotes,
    };

    applyOptimisticGoogleEntry(optimisticEntry);

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
      clearPendingGoogleMutation(entry.id);
    });
  }, [applyOptimisticGoogleEntry, clearPendingGoogleMutation, refreshGoogle, setGoogleCalendarEntries, tz]);

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

  const dayData = weekDays.map((day) => {
    const ds = format(day, 'yyyy-MM-dd');
    const dayGoogleEntries = selectGoogleCalendarEntriesForDate(googleCalendarEntries, ds);
    const dayTimedTasks = selectMyDayTasks(tasks, ds).filter((t) => t.startTime && t.endTime);
    const dayOverflowGoogleEntries = selectNextDayEarlyGoogleCalendarEntries(googleCalendarEntries, ds);
    const dayOverflowTasks = selectNextDayEarlyMyDayTasks(tasks, ds);
    const dayTasks = tasks.filter((t) => t.date === ds && (t.location === 'today' || t.location === 'upcoming'));
    const overlapItems = [
      ...dayGoogleEntries.map((e) => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
      ...dayTimedTasks.map((t) => ({ id: t.id, startTime: t.startTime!, endTime: t.endTime! })),
    ];
    const depths = computeOverlapDepths(overlapItems);

    const handleDayDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement) !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const snapped = snapTo15Min((y / SLOT_HEIGHT) * 60);
      const startMinutes = Math.max(0, Math.min(snapped, END_HOUR * 60 - 60));
      const endMinutes = startMinutes + 60;
      const baseDate = new Date(`${ds}T00:00:00`);
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
        applyOptimisticGoogleEntry(created);
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

    return {
      ds,
      day,
      isToday: ds === todayStr,
      dayGoogleEntries,
      dayTimedTasks,
      dayOverflowGoogleEntries,
      dayOverflowTasks,
      dayTasks,
      depths,
      handleDayDoubleClick,
    };
  });

  return (
    <WeekViewColumnView
      weekDays={weekDays}
      todayStr={todayStr}
      googleAllDayEvents={googleAllDayEvents}
      scrollRef={scrollRef}
      timeOffset={timeOffset}
      timeLabel={timeLabel}
      tasksHeight={tasksHeight}
      addingDay={addingDay}
      addValue={addValue}
      setAddValue={setAddValue}
      setAddingDay={setAddingDay}
      addTaskForDay={(title, day) => addTask({ title, location: 'today', date: day })}
      handleResizePointerDown={handleResizePointerDown}
      makeDayColRef={makeDayColRef}
      setCurrentDateAndView={(date) => { setCurrentDate(date); setViewMode('day'); }}
      onTaskDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
      onGoogleEntryDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
      onToggleTask={toggleTask}
      onTaskResizeEnd={(id, endTime) => updateTask(id, { endTime })}
      onTaskRepositionEnd={(id, startTime, endTime, pos) => {
        const task = tasks.find((t) => t.id === id);
        if (!task) return;
        if (!pos) {
          updateTask(id, { startTime, endTime });
          return;
        }
        if (!isInCalendar(pos.y)) {
          const dayAtX = dateFromClientX(pos.x);
          if (dayAtX) moveTask(id, { location: 'today', date: dayAtX });
          else moveTask(id, { location: 'backlog', date: undefined });
          return;
        }
        const targetDate = dateFromClientX(pos.x) ?? task.date!;
        if (targetDate === task.date) updateTask(id, { startTime, endTime });
        else moveTask(id, { location: 'myday', date: targetDate, startTime, endTime });
      }}
      onGoogleResizeEnd={(id, date, endTime) => updateGoogleEntry(id, { date, endTime })}
      onGoogleRepositionEnd={(id, date, startTime, endTime, pos) => {
        const targetDate = pos ? (dateFromClientX(pos.x) ?? date) : date;
        updateGoogleEntry(id, { date: targetDate, startTime, endTime });
      }}
      dayData={dayData}
      popover={popover}
      closePopover={() => setPopover(null)}
    />
  );
}
