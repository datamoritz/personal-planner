'use client';

import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlannerStore } from '@/store/usePlannerStore';
import { CalendarEntryBlock } from '@/components/ui/CalendarEntryBlock';
import { TimedTaskBlock } from '@/components/ui/TimedTaskBlock';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { GoogleCalendarEntryDetailPopover } from '@/components/ui/GoogleCalendarEntryDetailPopover';
import { selectGoogleAllDayEventsForDate } from '@/store/usePlannerStore';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToOffset,
  durationToHeight,
} from '@/lib/timeGrid';
import type { Task } from '@/types';
import type { OverlapDepthMap } from './sharedCalendarViewTypes';

const TOTAL_HOURS = END_HOUR;
const GRID_HEIGHT = TOTAL_HOURS * SLOT_HEIGHT;
const TIME_GUTTER_W = 44;
const WEEK_OVERLAP_SHIFT = 10;

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

function CalendarDayDropZone({
  dateStr,
  dayColRef,
  className,
  onDoubleClick,
  children,
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

function WeekTaskItem({
  task,
  containerId,
  onToggle,
  onDoubleClick,
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
  const tags = usePlannerStore((s) => s.tags);
  const tag = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  const tagBg = !isDone && tag ? tag.colorDark + '24' : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : isDone ? 0.5 : 1,
        background: tagBg,
        boxShadow: isDone ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.025), 0 4px 10px rgba(15, 23, 42, 0.02)',
      }}
      {...attributes}
      {...listeners}
      className={[
        'flex items-center gap-1.5 px-1.5 py-1 rounded-[0.85rem] cursor-grab select-none transition-transform',
        isDone
          ? 'bg-[var(--color-task-pill)]'
          : tag
          ? ''
          : 'bg-[var(--color-task-pill)]',
      ].join(' ')}
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
      <span
        className={[
          'flex-1 min-w-0 truncate text-[11px] leading-tight',
          isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
        ].join(' ')}
      >
        {task.title}
      </span>
    </div>
  );
}

type Popover =
  | { type: 'task'; id: string; anchor: HTMLElement }
  | { type: 'google-entry'; id: string; anchor: HTMLElement; isDraft?: boolean }
  | null;

interface WeekDayData {
  ds: string;
  day: Date;
  isToday: boolean;
  dayTasks: Task[];
  dayGoogleEntries: Array<{ id: string; title: string; date: string; startTime: string; endTime: string; notes?: string | null }>;
  dayTimedTasks: Task[];
  dayOverflowGoogleEntries: Array<{ id: string; title: string; date: string; startTime: string; endTime: string; notes?: string | null }>;
  dayOverflowTasks: Task[];
  depths: OverlapDepthMap;
  handleDayDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

interface WeekViewColumnViewProps {
  weekDays: Date[];
  todayStr: string;
  googleAllDayEvents: Array<{ id: string; date: string; title: string; notes?: string | null }>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  timeOffset: number;
  timeLabel: string;
  tasksHeight: number;
  addingDay: string | null;
  addValue: string;
  setAddValue: (value: string) => void;
  setAddingDay: (day: string | null) => void;
  addTaskForDay: (title: string, day: string) => void;
  handleResizePointerDown: (e: React.PointerEvent) => void;
  makeDayColRef: (ds: string) => (el: HTMLDivElement | null) => void;
  setCurrentDateAndView: (date: string) => void;
  onTaskDoubleClick: (id: string, anchor: HTMLElement) => void;
  onGoogleEntryDoubleClick: (id: string, anchor: HTMLElement) => void;
  onToggleTask: (id: string) => void;
  onTaskResizeEnd: (id: string, endTime: string) => void;
  onTaskRepositionEnd: (id: string, startTime: string, endTime: string, pos?: { x: number; y: number }) => void;
  onGoogleResizeEnd: (id: string, date: string, endTime: string) => void;
  onGoogleRepositionEnd: (id: string, date: string, startTime: string, endTime: string, pos?: { x: number; y: number }) => void;
  dayData: WeekDayData[];
  popover: Popover;
  closePopover: () => void;
}

export function WeekViewColumnView({
  weekDays,
  todayStr,
  googleAllDayEvents,
  scrollRef,
  timeOffset,
  timeLabel,
  tasksHeight,
  addingDay,
  addValue,
  setAddValue,
  setAddingDay,
  addTaskForDay,
  handleResizePointerDown,
  makeDayColRef,
  setCurrentDateAndView,
  onTaskDoubleClick,
  onGoogleEntryDoubleClick,
  onToggleTask,
  onTaskResizeEnd,
  onTaskRepositionEnd,
  onGoogleResizeEnd,
  onGoogleRepositionEnd,
  dayData,
  popover,
  closePopover,
}: WeekViewColumnViewProps) {
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);

  return (
    <div
      className="flex flex-col h-full overflow-hidden border-t-2 border-t-[var(--color-accent)]"
      style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
    >
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
                onClick={() => setCurrentDateAndView(ds)}
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

      {weekDays.some((d) => selectGoogleAllDayEventsForDate(googleAllDayEvents, format(d, 'yyyy-MM-dd')).length > 0) && (
        <div className="flex flex-shrink-0 border-b border-[var(--color-border)]">
          <div className="flex-shrink-0" style={{ width: TIME_GUTTER_W }} aria-hidden="true" />
          {weekDays.map((day) => {
            const ds = format(day, 'yyyy-MM-dd');
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

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex" style={{ height: GRID_HEIGHT }}>
          <div className="flex-shrink-0 relative" style={{ width: TIME_GUTTER_W }}>
            {hours.map((h) => (
              <div key={h} className="absolute left-0 right-0 flex items-start pointer-events-none" style={{ top: h * SLOT_HEIGHT }}>
                <span className="w-full text-right pr-1.5 text-[9px] text-[var(--color-text-secondary)] leading-none -mt-[5px] select-none font-medium">
                  {h === 0 ? '' : formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {dayData.map(({ ds, isToday, dayGoogleEntries, dayTimedTasks, dayOverflowGoogleEntries, dayOverflowTasks, depths, handleDayDoubleClick }) => {
            const now = new Date();
            const isYesterday = todayStr !== '' && (() => {
              const d = new Date(todayStr + 'T00:00:00');
              d.setDate(d.getDate() - 1);
              return ds === format(d, 'yyyy-MM-dd') && now.getHours() < 2;
            })();
            const isPastDay = ds < todayStr && !isYesterday;

            return (
              <CalendarDayDropZone
                key={ds}
                dateStr={ds}
                dayColRef={makeDayColRef(ds)}
                className="flex-1 relative border-l border-[var(--color-border-grid)] overflow-visible"
                onDoubleClick={handleDayDoubleClick}
              >
                {hours.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-[var(--color-border-grid)] pointer-events-none" style={{ top: h * SLOT_HEIGHT }} />
                ))}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div key={`h-${i}`} className="absolute left-0 right-0 border-t border-dashed border-[var(--color-border-grid)] opacity-40 pointer-events-none" style={{ top: (i + 0.5) * SLOT_HEIGHT }} />
                ))}

                {isPastDay && (
                  <div className="absolute left-0 right-0 top-0 pointer-events-none z-[1]" style={{ height: GRID_HEIGHT, background: 'var(--color-past-overlay)' }} />
                )}
                {isYesterday && (
                  <div
                    className="absolute left-0 right-0 top-0 pointer-events-none z-[1]"
                    style={{ height: minutesToOffset(24 * 60 + now.getHours() * 60 + now.getMinutes()), background: 'var(--color-past-overlay)' }}
                  />
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
                  <div className="absolute left-0 right-0 top-0 pointer-events-none z-[1]" style={{ height: timeOffset, background: 'var(--color-past-overlay)' }} />
                )}
                {isToday && (
                  <div className="absolute left-0 right-0 flex items-center pointer-events-none z-50 -translate-y-1/2" style={{ top: timeOffset }}>
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
                      onDoubleClick={onGoogleEntryDoubleClick}
                      onResizeEnd={(id, t) => onGoogleResizeEnd(id, ds, t)}
                      onRepositionEnd={(id, s, en, pos) => onGoogleRepositionEnd(id, ds, s, en, pos)}
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
                      onToggle={onToggleTask}
                      onDoubleClick={onTaskDoubleClick}
                      onResizeEnd={onTaskResizeEnd}
                      onRepositionEnd={onTaskRepositionEnd}
                    />
                  );
                })}

                {dayOverflowGoogleEntries.map((entry) => (
                  <CalendarEntryBlock
                    key={`overflow-google-${entry.id}`}
                    entry={entry}
                    compact
                    readOnly
                    style={{ top: minutesToOffset(24 * 60 + timeToMinutes(entry.startTime)) + 1, height: Math.max(durationToHeight(entry.startTime, entry.endTime) - 2, 20), left: 0, right: 2, zIndex: 4, opacity: 0.7 }}
                    onDoubleClick={onGoogleEntryDoubleClick}
                    onResizeEnd={(id, t) => onGoogleResizeEnd(id, ds, t)}
                    onRepositionEnd={(id, s, en, pos) => onGoogleRepositionEnd(id, ds, s, en, pos)}
                  />
                ))}

                {dayOverflowTasks.map((task) => (
                  <TimedTaskBlock
                    key={`overflow-${task.id}`}
                    compact
                    task={task}
                    style={{ top: minutesToOffset(24 * 60 + timeToMinutes(task.startTime!)) + 1, height: Math.max(durationToHeight(task.startTime!, task.endTime!) - 2, 20), left: 0, right: 2, zIndex: 4, opacity: 0.7 }}
                    onToggle={onToggleTask}
                    onDoubleClick={onTaskDoubleClick}
                    onResizeEnd={onTaskResizeEnd}
                    onRepositionEnd={onTaskRepositionEnd}
                  />
                ))}
              </CalendarDayDropZone>
            );
          })}
        </div>
      </div>

      <div
        onPointerDown={handleResizePointerDown}
        className="flex-shrink-0 h-2 flex items-center justify-center border-t border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-row-resize group"
      >
        <div className="w-8 h-0.5 rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-accent)] transition-colors" />
      </div>

      <div className="flex flex-shrink-0 border-t border-[var(--color-border)]" style={{ height: tasksHeight }}>
        <div className="flex-shrink-0 flex items-start justify-end pt-1.5 pr-1" style={{ width: TIME_GUTTER_W }}>
          <span className="text-[8px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">Tasks</span>
        </div>

        {weekDays.map((day) => {
          const ds = format(day, 'yyyy-MM-dd');
          const cId = `week-today-${ds}`;
          const nonTimedTasks = dayData.find((item) => item.ds === ds)?.dayTasks ?? [];
          const isAdding = addingDay === ds;

          return (
            <div key={ds} className="flex-1 flex flex-col border-l border-[var(--color-border-grid)] overflow-hidden min-w-0">
              <div className="flex items-center justify-end px-1 pt-1 flex-shrink-0">
                <button
                  onClick={() => { setAddingDay(ds); setAddValue(''); }}
                  title={`Add task for ${format(day, 'EEE')}`}
                  className="ui-icon-button !w-5 !h-5"
                >
                  <Plus size={10} strokeWidth={2.5} />
                </button>
              </div>

              <DroppableSection
                containerId={cId}
                itemIds={nonTimedTasks.map((t) => t.id)}
                className="flex-1 overflow-y-auto px-1 pb-1.5 flex flex-col gap-1 min-h-0"
              >
                {nonTimedTasks.map((task) => (
                  <WeekTaskItem
                    key={task.id}
                    task={task}
                    containerId={cId}
                    onToggle={onToggleTask}
                    onDoubleClick={onTaskDoubleClick}
                  />
                ))}
                {isAdding && (
                  <input
                    autoFocus
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const title = addValue.trim();
                        if (title) addTaskForDay(title, ds);
                        setAddingDay(null);
                      } else if (e.key === 'Escape') {
                        setAddingDay(null);
                      }
                    }}
                    onBlur={() => {
                      const title = addValue.trim();
                      if (title) addTaskForDay(title, ds);
                      setAddingDay(null);
                    }}
                    placeholder="Task…"
                    className="w-full px-2 py-1 rounded-[0.85rem] border border-dashed border-[var(--color-task-draft-border)] bg-[var(--color-task-draft)] text-[11px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
                  />
                )}
              </DroppableSection>
            </div>
          );
        })}
      </div>

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={closePopover} />
      )}
      {popover?.type === 'google-entry' && (
        <GoogleCalendarEntryDetailPopover entryId={popover.id} anchor={popover.anchor} onClose={closePopover} isDraft={popover.isDraft} />
      )}
    </div>
  );
}
