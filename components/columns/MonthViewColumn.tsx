'use client';

import { addDays, differenceInCalendarDays, endOfMonth, format, isSameMonth, startOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { useDndMonitor, type DragEndEvent } from '@dnd-kit/core';
import {
  usePlannerStore,
  selectGoogleAllDayEventsForDate,
  selectGoogleCalendarEntriesForDate,
  selectMergedGoogleCalendarEntryById,
  selectMyDayTasks,
  selectTasksToday,
} from '@/store/usePlannerStore';
import type { MonthViewMode } from '@/types';
import { MonthViewColumnView } from './MonthViewColumnView';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { GoogleCalendarEntryDetailPopover } from '@/components/ui/GoogleCalendarEntryDetailPopover';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import * as api from '@/lib/api';

interface MonthViewColumnProps {
  monthViewMode: MonthViewMode;
  showEventTimes: boolean;
}

export function MonthViewColumn({ monthViewMode, showEventTimes }: MonthViewColumnProps) {
  const {
    currentDate,
    tasks,
    googleCalendarEntries,
    googleAllDayEvents,
    activeTagFilter,
    addTask,
    toggleTask,
    moveTask,
    setCurrentDate,
    setViewMode,
    applyOptimisticGoogleEntry,
    clearPendingGoogleMutation,
    setGoogleCalendarEntries,
    applyOptimisticGoogleAllDayEvent,
    clearPendingGoogleAllDayMutation,
    setGoogleAllDayEvents,
    monthTaskLayout,
  } = usePlannerStore();
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [popover, setPopover] = useState<
    | { type: 'task'; id: string; anchor: HTMLElement }
    | { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean }
    | null
  >(null);
  const { refresh: refreshGoogle } = useGoogleCalendar();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const baseDate = new Date(currentDate + 'T00:00:00');
  const monthStart = startOfMonth(baseDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 });

  const days = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    const ds = format(day, 'yyyy-MM-dd');
    const untimedTasks = selectTasksToday(tasks, ds).filter((task) =>
      activeTagFilter ? task.tagId === activeTagFilter : true
    );
    const timedTasks = selectMyDayTasks(tasks, ds)
      .filter((task) => !!task.startTime && !!task.endTime)
      .filter((task) => (activeTagFilter ? task.tagId === activeTagFilter : true))
      .sort((a, b) => (a.startTime! > b.startTime! ? 1 : -1));
    const googleTimedEntries = selectGoogleCalendarEntriesForDate(googleCalendarEntries, ds)
      .sort((a, b) => (a.startTime > b.startTime ? 1 : -1));
    const allDayEvents = selectGoogleAllDayEventsForDate(googleAllDayEvents, ds);

    days.push({
      date: day,
      dateString: ds,
      inCurrentMonth: isSameMonth(day, baseDate),
      untimedTasks,
      timedTasks,
      googleTimedEntries,
      allDayEvents,
    });
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const updateGoogleEntryDate = useCallback((entryId: string, nextDate: string) => {
    const prevEntries = usePlannerStore.getState().googleCalendarEntries;
    const entry = selectMergedGoogleCalendarEntryById(prevEntries, entryId);
    if (!entry) return;

    const startDate = entry.startDate ?? entry.date;
    const endDate = entry.endDate ?? startDate;
    const dayDelta = differenceInCalendarDays(new Date(`${endDate}T00:00:00`), new Date(`${startDate}T00:00:00`));
    const shiftedEndDate = format(addDays(new Date(`${nextDate}T00:00:00`), dayDelta), 'yyyy-MM-dd');

    const optimisticEntry = {
      ...entry,
      id: entry.id.split('::')[0],
      date: nextDate,
      startDate: nextDate,
      endDate: shiftedEndDate,
    };

    applyOptimisticGoogleEntry(optimisticEntry);
    api.patchGoogleTimedEvent(entry.id.split('::')[0], {
      title: entry.title,
      date: nextDate,
      endDate: shiftedEndDate,
      startTime: entry.startTime,
      endTime: entry.endTime,
      notes: entry.notes ?? undefined,
      tz,
    }).then(() => {
      refreshGoogle();
    }).catch((err) => {
      console.error('[patchGoogleTimedEvent month move]', err);
      setGoogleCalendarEntries(prevEntries);
      clearPendingGoogleMutation(entry.id);
    });
  }, [applyOptimisticGoogleEntry, clearPendingGoogleMutation, refreshGoogle, setGoogleCalendarEntries, tz]);

  const updateAllDayEventDate = useCallback((eventId: string, nextDate: string) => {
    const prevEvents = usePlannerStore.getState().googleAllDayEvents;
    const entry = prevEvents.find((event) => event.id === eventId);
    if (!entry) return;

    const startDate = entry.date;
    const endDate = entry.endDate ?? startDate;
    const dayDelta = differenceInCalendarDays(new Date(`${endDate}T00:00:00`), new Date(`${startDate}T00:00:00`));
    const shiftedEndDate = format(addDays(new Date(`${nextDate}T00:00:00`), dayDelta), 'yyyy-MM-dd');
    const optimisticEntry = {
      ...entry,
      date: nextDate,
      endDate: shiftedEndDate,
    };

    applyOptimisticGoogleAllDayEvent(optimisticEntry);

    api.patchGoogleAllDayEvent(entry.id, {
      title: entry.title,
      date: nextDate,
      endDate: shiftedEndDate,
      notes: entry.notes ?? undefined,
    }).then(() => {
      refreshGoogle();
    }).catch((err) => {
      console.error('[patchGoogleAllDayEvent month move]', err);
      setGoogleAllDayEvents(prevEvents);
      clearPendingGoogleAllDayMutation(entry.id);
    });
  }, [applyOptimisticGoogleAllDayEvent, clearPendingGoogleAllDayMutation, refreshGoogle, setGoogleAllDayEvents]);

  useDndMonitor({
    onDragEnd(event: DragEndEvent) {
      const { active, over } = event;
      if (!over) return;

      const sourceData = active.data.current as { type?: string; containerId?: string } | undefined;
      const overData = over.data.current as { containerId?: string } | undefined;
      const destContainer = overData?.containerId ?? String(over.id).replace(/^drop-/, '');

      if (!destContainer.startsWith('month-events-')) return;
      const targetDate = destContainer.replace('month-events-', '');

      if (sourceData?.type === 'google-entry') {
        updateGoogleEntryDate(String(active.id), targetDate);
      } else if (sourceData?.type === 'google-all-day') {
        updateAllDayEventDate(String(active.id), targetDate);
      } else if (sourceData?.type === 'task') {
        const task = tasks.find((t) => t.id === String(active.id));
        if (!task?.startTime || !task.endTime) return;
        moveTask(task.id, {
          location: 'myday',
          date: targetDate,
          startTime: task.startTime,
          endTime: task.endTime,
        });
      }
    },
  });

  useEffect(() => {
    return () => {
      if (popover?.anchor.dataset.popoverAnchor === 'temporary') {
        popover.anchor.remove();
      }
    };
  }, [popover]);

  return (
    <>
      <MonthViewColumnView
        weeks={weeks}
        monthViewMode={monthViewMode}
        monthTaskLayout={monthTaskLayout}
        showEventTimes={showEventTimes}
        addingDay={addingDay}
        setAddingDay={setAddingDay}
        addTaskForDay={(title, date) => {
        addTask({ title, location: 'today', date });
        setAddingDay(null);
        }}
        onToggleTask={toggleTask}
        onOpenDay={(date) => {
          setCurrentDate(date);
          setViewMode('day');
        }}
        onTaskDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
        onGoogleEntryDoubleClick={(id, anchor) => setPopover({ type: 'google-entry', id, anchor })}
        onEventCellDoubleClick={(date, anchor) => {
          api.createGoogleTimedEvent({
            title: 'New event',
            date,
            startTime: '09:00',
            endTime: '10:00',
            tz,
          }).then((created) => {
            applyOptimisticGoogleEntry(created);
            setPopover({ type: 'google-entry', id: created.id, anchor, isDraft: true });
          }).catch((err) => {
            console.error('[createGoogleTimedEvent month]', err);
            if (anchor.dataset.popoverAnchor === 'temporary') anchor.remove();
          });
        }}
      />
      {popover?.type === 'task' && (
        <TaskDetailPopover
          taskId={popover.id}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
        />
      )}
      {popover?.type === 'google-entry' && (
        <GoogleCalendarEntryDetailPopover
          entryId={popover.id}
          anchor={popover.anchor}
          isDraft={popover.isDraft}
          onClose={() => {
            if (popover.anchor.dataset.popoverAnchor === 'temporary') {
              popover.anchor.remove();
            }
            setPopover(null);
          }}
        />
      )}
    </>
  );
}
