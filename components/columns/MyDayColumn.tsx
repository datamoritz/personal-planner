'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDndMonitor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { addDays, format } from 'date-fns';
import {
  usePlannerStore,
  selectMyDayTasks,
  selectGoogleCalendarEntriesForDate,
  selectMergedGoogleCalendarEntryById,
  selectGoogleAllDayEventsForDate,
  selectNextDayEarlyGoogleCalendarEntries,
  selectNextDayEarlyMyDayTasks,
} from '@/store/usePlannerStore';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToTime,
  minutesToOffset,
  snapTo15Min,
  normalizeGridEventRange,
} from '@/lib/timeGrid';
import { computeOverlapDepths } from '@/lib/overlapLayout';
import type { OverlapItem } from '@/lib/overlapLayout';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { MyDayColumnView } from './MyDayColumnView';

const TOTAL_HOURS      = END_HOUR;
const DEFAULT_SCROLL_H = 8;

type TaskPopover  = { type: 'task';  id: string; anchor: HTMLElement };
type GoogleEntryPopover = { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean };
type BirthdayPopover = { type: 'birthday'; event: import('@/types').AllDayEvent; anchor: HTMLElement };
type PopoverState = TaskPopover | GoogleEntryPopover | BirthdayPopover | null;

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

export function MyDayColumn({ onFocusMode, onActionsMode }: { onFocusMode?: (active: boolean) => void; onActionsMode?: (active: boolean) => void }) {
  const {
    currentDate, tasks, googleCalendarEntries, googleAllDayEvents,
    toggleTask,
    updateTask, moveTask, applyOptimisticGoogleEntry, clearPendingGoogleMutation, setGoogleCalendarEntries, setViewMode,
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

  const overlapItems: OverlapItem[] = [
    ...googleEntries.map(e => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    ...timedTasks.filter(t => t.startTime && t.endTime).map(t => ({ id: t.id, startTime: t.startTime!, endTime: t.endTime! })),
  ];
  const depths = computeOverlapDepths(overlapItems);
  const hours  = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);

  return (
    <MyDayColumnView
      notepadOpen={notepadOpen}
      actionsMode={actionsMode}
      focusMode={focusMode}
      allDayEvents={allDayEvents}
      hours={hours}
      setRef={setRef}
      handleGridDoubleClick={handleGridDoubleClick}
      toggleNotepad={toggleNotepad}
      toggleFocus={toggleFocus}
      onActionsModeChange={() => {
        const next = !actionsMode;
        setActionsMode(next);
        onActionsMode?.(next);
      }}
      setWeekView={() => setViewMode('week')}
      onToggleTask={toggleTask}
      onTaskDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
      onGoogleEntryDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
      onBirthdayClick={(event, anchor) => setPopover({ type: 'birthday', event, anchor })}
      onAllDayEmptyDoubleClick={(anchor) => {
        const rect = anchor.getBoundingClientRect();
        const clickAnchor = createClickAnchor(rect.left, rect.top);
        api.createGoogleAllDayEvent({
          title: 'New event',
          date: currentDate,
        }).then((created) => {
          setPopover({
            type: 'google-entry',
            id: created.id,
            anchor: clickAnchor,
            isDraft: true,
          });
          refreshGoogle();
        }).catch((err) => {
          console.error('[createGoogleAllDayEvent myday]', err);
          clickAnchor.remove();
        });
      }}
      onTaskResizeEnd={(id, endTime) => updateTask(id, { endTime })}
      onTaskRepositionEnd={(id, startTime, endTime) => updateTask(id, { startTime, endTime })}
      onGoogleResizeEnd={(id, endTime) => updateGoogleEntry(id, { date: currentDate, endTime })}
      onGoogleRepositionEnd={(id, startTime, endTime) => updateGoogleEntry(id, { date: currentDate, startTime, endTime })}
      timedTasks={timedTasks}
      googleEntries={googleEntries}
      overflowGoogleEntries={overflowGoogleEntries}
      overflowTasks={overflowTasks}
      depths={depths}
      isYesterday={isYesterday}
      timeOffset={timeOffset}
      timeLabel={timeLabel}
      popover={popover}
      closePopover={closePopover}
    />
  );
}
