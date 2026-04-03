'use client';

import { format } from 'date-fns';
import { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { MonthViewMode, MonthTaskLayout, Task, CalendarEntry, AllDayEvent } from '@/types';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';

interface MonthDayData {
  date: Date;
  dateString: string;
  inCurrentMonth: boolean;
  untimedTasks: Task[];
  timedTasks: Task[];
  googleTimedEntries: CalendarEntry[];
  allDayEvents: AllDayEvent[];
}

interface MonthViewColumnViewProps {
  weeks: MonthDayData[][];
  monthViewMode: MonthViewMode;
  monthTaskLayout: MonthTaskLayout;
  showEventTimes: boolean;
  addingDay: string | null;
  setAddingDay: (day: string | null) => void;
  addTaskForDay: (title: string, day: string) => void;
  onToggleTask: (id: string) => void;
  onOpenDay: (date: string) => void;
  onTaskDoubleClick: (id: string, anchor: HTMLElement) => void;
  onGoogleEntryDoubleClick: (id: string, anchor: HTMLElement) => void;
  onEventCellDoubleClick: (date: string, anchor: HTMLElement) => void;
}

function formatEventTime(time?: string) {
  if (!time) return '';
  const [rawHour, rawMinute] = time.split(':').map(Number);
  const hour = rawHour % 24;
  const minute = rawMinute ?? 0;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  if (minute === 0) return `${displayHour} ${suffix}`;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function MonthEventRow({
  title,
  time,
  tone,
  showTime,
  isStart = true,
  isEnd = true,
  isDragging = false,
  isPending = false,
}: {
  title: string;
  time?: string;
  tone: 'google' | 'task' | 'all-day' | 'birthday';
  showTime: boolean;
  isStart?: boolean;
  isEnd?: boolean;
  isDragging?: boolean;
  isPending?: boolean;
}) {
  const toneClass =
    tone === 'google'
      ? 'bg-[color-mix(in_srgb,var(--color-google-event)_94%,white_6%)] text-[var(--color-google-event-text)]'
      : tone === 'task'
      ? 'bg-[color-mix(in_srgb,var(--color-accent-subtle)_92%,white_8%)] text-[var(--color-accent)]'
      : tone === 'birthday'
      ? 'bg-[color-mix(in_srgb,#f97316_12%,white_88%)] text-[#b45309]'
      : 'bg-[color-mix(in_srgb,var(--color-google-event-text)_68%,var(--color-google-event)_32%)] text-[color-mix(in_srgb,white_86%,var(--color-google-event-text)_14%)]';

  return (
    <div
      className={[
        `flex items-center gap-1.5 px-2 py-1 text-[11px] leading-tight ${toneClass}`,
        isStart ? 'rounded-l-[0.7rem]' : '-ml-1 rounded-l-none pl-2.5',
        isEnd ? 'rounded-r-[0.7rem]' : '-mr-1 rounded-r-none pr-2.5',
      ].join(' ')}
      style={{
        opacity: isDragging ? 0.84 : isPending ? 0.9 : 1,
        boxShadow: isDragging ? '0 8px 20px rgba(15, 23, 42, 0.12)' : undefined,
      }}
    >
      <span className="truncate flex-1 min-w-0 font-medium">{title}</span>
      {showTime && time && <span className="flex-shrink-0 text-[10px] opacity-80">{time}</span>}
    </div>
  );
}

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

function MonthTaskRow({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  const isDone = task.status === 'done';
  const tags = usePlannerStore((s) => s.tags);
  const tag = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  const tagBg = !isDone && tag ? tag.colorDark + '24' : undefined;

  return (
    <div
      style={{
        background: tagBg,
        boxShadow: isDone ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.025), 0 4px 10px rgba(15, 23, 42, 0.02)',
      }}
      className={[
        'flex items-center gap-1.5 rounded-[0.85rem] px-2 py-1.5 text-[11px] leading-tight transition-transform',
        isDone ? 'opacity-60' : '',
        isDone
          ? 'bg-[var(--color-task-pill)]'
          : tag
          ? ''
          : 'bg-[var(--color-task-pill)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task.id);
        }}
        className={[
          'w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors',
          isDone
            ? 'bg-[var(--color-done)] border-[var(--color-done)] opacity-70'
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
          'truncate min-w-0 flex-1 text-[var(--color-text-primary)]',
          isDone ? 'line-through text-[var(--color-text-muted)]' : '',
        ].join(' ')}
      >
        {task.title}
      </span>
    </div>
  );
}

function MonthSortableTaskRow({
  task,
  containerId,
  onToggleTask,
  onTaskDoubleClick,
}: {
  task: Task;
  containerId: string;
  onToggleTask: (id: string) => void;
  onTaskDoubleClick: (id: string, anchor: HTMLElement) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', containerId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      {...attributes}
      {...listeners}
      className="rounded-[0.85rem] cursor-grab"
      onDoubleClick={(e) => {
        e.stopPropagation();
        onTaskDoubleClick(task.id, e.currentTarget);
      }}
    >
      <MonthTaskRow task={task} onToggle={onToggleTask} />
    </div>
  );
}

function MonthDraggableEventRow({
  id,
  containerId,
  title,
  time,
  tone,
  showTime,
  onDoubleClick,
  dragType,
  isStart,
  isEnd,
  isPending,
}: {
  id: string;
  containerId: string;
  title: string;
  time?: string;
  tone: 'google' | 'task' | 'all-day' | 'birthday';
  showTime: boolean;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  dragType: 'google-entry' | 'google-all-day' | 'task';
  isStart?: boolean;
  isEnd?: boolean;
  isPending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { type: dragType, containerId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.96 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      {...attributes}
      {...listeners}
      className="cursor-grab"
      onDoubleClick={(e) => {
        if (!onDoubleClick) return;
        e.stopPropagation();
        onDoubleClick(id, e.currentTarget);
      }}
    >
      <MonthEventRow
        title={title}
        time={time}
        tone={tone}
        showTime={showTime}
        isStart={isStart}
        isEnd={isEnd}
        isDragging={isDragging}
        isPending={isPending}
      />
    </div>
  );
}

function MonthReadOnlyEventRow({
  title,
  time,
  tone,
  showTime,
  isStart,
  isEnd,
  isPending,
}: {
  title: string;
  time?: string;
  tone: 'google' | 'task' | 'all-day' | 'birthday';
  showTime: boolean;
  isStart?: boolean;
  isEnd?: boolean;
  isPending?: boolean;
}) {
  return (
    <div className="cursor-default">
      <MonthEventRow
        title={title}
        time={time}
        tone={tone}
        showTime={showTime}
        isStart={isStart}
        isEnd={isEnd}
        isPending={isPending}
      />
    </div>
  );
}

function MonthDayCell({
  day,
  todayString,
  monthViewMode,
  monthTaskLayout,
  showEventTimes,
  addingDay,
  setAddingDay,
  addTaskForDay,
  onToggleTask,
  onOpenDay,
  onTaskDoubleClick,
  onGoogleEntryDoubleClick,
  onEventCellDoubleClick,
}: {
  day: MonthDayData;
  todayString: string;
  monthViewMode: MonthViewMode;
  monthTaskLayout: MonthTaskLayout;
  showEventTimes: boolean;
  addingDay: string | null;
  setAddingDay: (day: string | null) => void;
  addTaskForDay: (title: string, day: string) => void;
  onToggleTask: (id: string) => void;
  onOpenDay: (date: string) => void;
  onTaskDoubleClick: (id: string, anchor: HTMLElement) => void;
  onGoogleEntryDoubleClick: (id: string, anchor: HTMLElement) => void;
  onEventCellDoubleClick: (date: string, anchor: HTMLElement) => void;
}) {
  const eventContainerId = `month-events-${day.dateString}`;
  const taskContainerId = `month-day-${day.dateString}`;
  const { setNodeRef: setEventDropRef, isOver: isEventOver } = useDroppable({
    id: `drop-${eventContainerId}`,
    data: { type: 'container', containerId: eventContainerId },
  });
  const { setNodeRef: setTaskDropRef, isOver: isTaskOver } = useDroppable({
    id: `drop-${taskContainerId}`,
    data: { type: 'container', containerId: taskContainerId },
  });

  const handleEventDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    const anchor = createClickAnchor(e.clientX, e.clientY);
    onEventCellDoubleClick(day.dateString, anchor);
  }, [day.dateString, onEventCellDoubleClick]);

  const cellTone = day.inCurrentMonth
    ? 'bg-[var(--color-center-col)]'
    : 'bg-[color-mix(in_srgb,var(--color-center-col)_82%,var(--color-surface)_18%)]';
  const isPastDay = day.dateString < todayString;

  return (
    <div
      className={[
        'relative min-h-0 border-l first:border-l-0 border-[var(--color-border-grid)] transition-colors',
        cellTone,
        monthViewMode === 'tasks' && isTaskOver
          ? 'bg-[color-mix(in_srgb,var(--color-accent-subtle)_42%,var(--color-center-col)_58%)]'
          : monthViewMode === 'events' && isEventOver
          ? 'bg-[color-mix(in_srgb,var(--color-google-event)_18%,var(--color-center-col)_82%)]'
          : 'hover:bg-[color-mix(in_srgb,var(--color-center-col)_92%,var(--color-surface-raised)_8%)]',
      ].join(' ')}
    >
      {isPastDay && (
        <div className="absolute inset-0 pointer-events-none z-[1]" style={{ background: 'var(--color-past-overlay)' }} />
      )}
      <div className="relative z-[2] flex flex-col h-full min-h-0">
        <div className="flex items-center justify-end px-2.5 pt-1.5 pb-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenDay(day.dateString)}
            title={`Open ${format(day.date, 'EEEE, MMMM d')}`}
            className={[
              'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold transition-colors cursor-pointer',
              day.dateString === todayString
                ? 'bg-red-500 text-white hover:bg-red-600'
                : day.inCurrentMonth
                ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
                : 'text-[var(--color-text-muted)] opacity-55 hover:bg-[var(--color-surface-raised)]',
            ].join(' ')}
          >
            {format(day.date, 'd')}
          </button>
        </div>

        {monthViewMode === 'tasks' ? (
          <div
            ref={setTaskDropRef}
            className={[
              'month-cell-scroll flex-1 px-1.5 pb-1.5 space-y-0.5',
              monthTaskLayout === 'grid' ? 'min-h-0 overflow-y-auto overflow-x-hidden' : 'overflow-visible',
            ].join(' ')}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement) !== e.currentTarget) return;
              setAddingDay(day.dateString);
            }}
          >
            <SortableContext items={day.untimedTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
              {day.untimedTasks.map((task) => (
                <MonthSortableTaskRow
                  key={task.id}
                  task={task}
                  containerId={taskContainerId}
                  onToggleTask={onToggleTask}
                  onTaskDoubleClick={onTaskDoubleClick}
                />
              ))}
              {addingDay === day.dateString && (
                <InlineTaskInput
                  placeholder="Task name…"
                  onSubmit={(title) => addTaskForDay(title, day.dateString)}
                  onCancel={() => setAddingDay(null)}
                />
              )}
            </SortableContext>
          </div>
        ) : (
          <div
            ref={setEventDropRef}
            className="month-cell-scroll flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5 space-y-0.5"
            onDoubleClick={handleEventDoubleClick}
          >
            {day.allDayEvents.map((event) => (
              event.readOnly || event.source === 'apple_birthdays' ? (
                <MonthReadOnlyEventRow
                  key={event.id}
                  title={event.title}
                  tone="birthday"
                  showTime={false}
                  isStart={event.date === day.dateString}
                  isEnd={(event.endDate ?? event.date) === day.dateString}
                  isPending={event.syncState === 'pending'}
                />
              ) : (
                <MonthDraggableEventRow
                  key={event.id}
                  id={event.id}
                  containerId={eventContainerId}
                  title={event.title}
                  tone="all-day"
                  showTime={false}
                  dragType="google-all-day"
                  onDoubleClick={onGoogleEntryDoubleClick}
                  isStart={event.date === day.dateString}
                  isEnd={(event.endDate ?? event.date) === day.dateString}
                  isPending={event.syncState === 'pending'}
                />
              )
            ))}
            {day.googleTimedEntries.map((entry) => (
              <MonthDraggableEventRow
                key={entry.id}
                id={entry.id}
                containerId={eventContainerId}
                title={entry.title}
                time={formatEventTime(entry.startTime)}
                tone="google"
                showTime={showEventTimes}
                dragType="google-entry"
                onDoubleClick={onGoogleEntryDoubleClick}
              />
            ))}
            {day.timedTasks.map((task) => (
              <MonthDraggableEventRow
                key={task.id}
                id={task.id}
                containerId={eventContainerId}
                title={task.title}
                time={task.startTime ? formatEventTime(task.startTime) : ''}
                tone="task"
                showTime={showEventTimes}
                dragType="task"
                onDoubleClick={onTaskDoubleClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MonthViewColumnView({
  weeks,
  monthViewMode,
  monthTaskLayout,
  showEventTimes,
  addingDay,
  setAddingDay,
  addTaskForDay,
  onToggleTask,
  onOpenDay,
  onTaskDoubleClick,
  onGoogleEntryDoubleClick,
  onEventCellDoubleClick,
}: MonthViewColumnViewProps) {
  const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayString = format(new Date(), 'yyyy-MM-dd');

  return (
    <div
      className="flex flex-col h-full overflow-hidden border-t-2 border-t-[var(--color-accent)]"
      style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
    >
      <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-center-col)] flex-shrink-0">
        {weekLabels.map((label) => (
          <div
            key={label}
            className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)] border-l first:border-l-0 border-[var(--color-border-grid)]"
          >
            {label}
          </div>
        ))}
      </div>

      <div className={monthTaskLayout === 'expanded' ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 overflow-hidden'}>
        <div
          className="grid min-h-full"
          style={{
            gridTemplateRows:
              monthTaskLayout === 'expanded'
                ? `repeat(${weeks.length}, minmax(136px, 1fr))`
                : `repeat(${weeks.length}, minmax(0, 1fr))`,
          }}
        >
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 min-h-0 border-b border-[var(--color-border)] last:border-b-0">
              {week.map((day) => (
                <MonthDayCell
                  key={day.dateString}
                  day={day}
                  todayString={todayString}
                  monthViewMode={monthViewMode}
                  monthTaskLayout={monthTaskLayout}
                  showEventTimes={showEventTimes}
                  addingDay={addingDay}
                  setAddingDay={setAddingDay}
                  addTaskForDay={addTaskForDay}
                  onToggleTask={onToggleTask}
                  onOpenDay={onOpenDay}
                  onTaskDoubleClick={onTaskDoubleClick}
                  onGoogleEntryDoubleClick={onGoogleEntryDoubleClick}
                  onEventCellDoubleClick={onEventCellDoubleClick}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
