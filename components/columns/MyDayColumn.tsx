'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDndMonitor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { format } from 'date-fns';
import {
  usePlannerStore,
  selectMyDayTasks,
  selectCalendarEntriesForDate,
  selectGoogleCalendarEntriesForDate,
  selectGoogleAllDayEventsForDate,
} from '@/store/usePlannerStore';
import { AllDayStrip } from '@/components/ui/AllDayStrip';
import { CalendarEntryBlock } from '@/components/ui/CalendarEntryBlock';
import { DraggableTimedTaskBlock } from '@/components/dnd/DraggableTimedTaskBlock';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { CalendarEntryDetailPopover } from '@/components/ui/CalendarEntryDetailPopover';
import { UncertaintyNotepad } from '@/components/ui/UncertaintyNotepad';
import { HelpCircle, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToTime,
  minutesToOffset,
  durationToHeight,
  snapTo15Min,
} from '@/lib/timeGrid';
import { computeOverlapDepths } from '@/lib/overlapLayout';
import type { OverlapItem } from '@/lib/overlapLayout';

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
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

type TaskPopover  = { type: 'task';  id: string; anchor: HTMLElement };
type EntryPopover = { type: 'entry'; id: string; anchor: HTMLElement };
type PopoverState = TaskPopover | EntryPopover | null;

export function MyDayColumn({ onFocusMode, onActionsMode }: { onFocusMode?: (active: boolean) => void; onActionsMode?: (active: boolean) => void }) {
  const {
    currentDate, tasks, calendarEntries, googleCalendarEntries, googleAllDayEvents,
    toggleTask, addCalendarEntry,
    updateCalendarEntry, updateTask, moveTask,
  } = usePlannerStore();

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
  const entries       = selectCalendarEntriesForDate(calendarEntries, currentDate);
  const googleEntries = selectGoogleCalendarEntriesForDate(googleCalendarEntries, currentDate);
  const allDayEvents  = selectGoogleAllDayEventsForDate(googleAllDayEvents, currentDate);
  const [today, setToday] = useState('');
  useEffect(() => { setToday(format(new Date(), 'yyyy-MM-dd')); }, []);
  const isToday    = today !== '' && currentDate === today;

  const [timeOffset, setTimeOffset] = useState<number | null>(isToday ? getCurrentTimeOffset() : null);
  const [timeLabel,  setTimeLabel]  = useState<string>(isToday ? getCurrentTimeLabel() : '');
  const [popover, setPopover]       = useState<PopoverState>(null);

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
    const y       = e.clientY - e.currentTarget.getBoundingClientRect().top + (scrollRef.current?.scrollTop ?? 0);
    const snapped = snapTo15Min((y / SLOT_HEIGHT) * 60);
    const start   = minutesToTime(Math.max(0, Math.min(snapped, END_HOUR * 60 - 60)));
    addCalendarEntry({ title: 'New event', date: currentDate, startTime: start, endTime: minutesToTime(timeToMinutes(start) + 60) });
  };

  const overlapItems: OverlapItem[] = [
    ...entries.map(e => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    ...googleEntries.map(e => ({ id: e.id, startTime: e.startTime, endTime: e.endTime })),
    ...timedTasks.filter(t => t.startTime && t.endTime).map(t => ({ id: t.id, startTime: t.startTime!, endTime: t.endTime! })),
  ];
  const depths = computeOverlapDepths(overlapItems);
  const hours  = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-[var(--color-border)]">
      {/* Header */}
      <div
        className={[
          'flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0 transition-colors',
          notepadOpen ? 'bg-[#fef9c3]' : '',
        ].join(' ')}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {notepadOpen ? 'What is uncertain?' : 'My Day'}
        </h2>
        <div className="flex items-center gap-1">
          {notepadOpen && (
            <>
              <button
                onClick={() => { const next = !actionsMode; setActionsMode(next); onActionsMode?.(next); }}
                title={actionsMode ? 'Hide action tools' : 'Show action tools'}
                className={[
                  'w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer',
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
                  'w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer',
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
              'w-6 h-6 flex items-center justify-center rounded transition-colors cursor-pointer',
              notepadOpen
                ? 'text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]',
            ].join(' ')}
          >
            <HelpCircle size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* All-day events strip — only when not in notepad mode */}
      {!notepadOpen && <AllDayStrip events={allDayEvents} />}

      {/* Notepad mode */}
      {notepadOpen && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#fefce8]">
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

            {/* Past tint — only on today, only up to the red line */}
            {timeOffset !== null && (
              <div
                className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                style={{
                  height: timeOffset,
                  background: 'var(--color-past-overlay)',
                }}
              />
            )}
            
            {timeOffset !== null && (
              <div
                className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2"
                style={{ top: timeOffset }}
              >
                {/* 1. The Apple-style Time Pill */}
                <div 
                  className="bg-[#ff3b30] text-white text-[10px] font-bold px-1.5 h-5 flex items-center justify-center rounded-full shadow-sm z-50 select-none"
                  style={{ 
                    marginLeft: '2px', // Slight nudge from the very edge
                    minWidth: '38px' 
                  }}
                >
                  {timeLabel}
                </div>

                {/* 2. The Red Line - Perfectly centered via the parent's flex items-center */}
                <div className="flex-1 h-[1px] bg-[#ff3b30]" />
              </div>
            )}

            {entries.map((entry) => {
              const depth = depths.get(entry.id) ?? 0;
              return (
                <CalendarEntryBlock
                  key={entry.id}
                  entry={entry}
                  style={{
                    top:    minutesToOffset(timeToMinutes(entry.startTime)) + 1,
                    height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 24),
                    left:   LEFT_BASE + depth * OVERLAP_SHIFT,
                    right:  4,
                    zIndex: 5 + depth,
                  }}
                  verticalOnly
                  onDoubleClick={(id, anchor) => setPopover({ type: 'entry', id, anchor })}
                  onResizeEnd={(id, t) => updateCalendarEntry(id, { endTime: t })}
                  onRepositionEnd={(id, s, e) => updateCalendarEntry(id, { startTime: s, endTime: e })}
                />
              );
            })}

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
          </div>
      </div>}

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.type === 'entry' && (
        <CalendarEntryDetailPopover entryId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
    </div>
  );
}
