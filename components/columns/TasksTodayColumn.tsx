'use client';

import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { FolderClosed, Plus } from 'lucide-react';
import { usePlannerStore, selectTasksToday } from '@/store/usePlannerStore';

import { SortableTaskItem } from '@/components/dnd/SortableTaskItem';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';

type PopoverState = { id: string; anchor: HTMLElement } | null;

export function TasksTodayColumn() {
  const { currentDate, tasks, addTask, toggleTask, viewMode, activeTagFilter } = usePlannerStore();
  const { setNodeRef } = useDroppable({
    id: 'drop-today-column',
    data: { type: 'container', containerId: 'today' },
  });
  const allTodayTasks = selectTasksToday(tasks, currentDate);
  const todayTasks = activeTagFilter
    ? allTodayTasks.filter((t) => t.tagId === activeTagFilter)
    : allTodayTasks;
  const [adding, setAdding] = useState(false);
  const [popover, setPopover] = useState<PopoverState>(null);
  const linkedProjectMarker = <FolderClosed size={11} className="text-[var(--color-text-muted)] opacity-75" strokeWidth={2.2} />;

  useEffect(() => {
    if (viewMode !== 'day') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setAdding(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode]);

  return (
    <div ref={setNodeRef} className="flex flex-col h-full overflow-hidden border-r border-[var(--color-border)]">
      <div className="flex h-[52px] items-center justify-between px-4 border-b border-[var(--color-border)] flex-shrink-0">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Tasks Today</h2>
        <div className="flex items-center gap-1.5">
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] bg-[var(--color-surface)] select-none leading-none opacity-70">
            N
          </kbd>
          <button
            onClick={() => setAdding(true)}
            title="Add task (N)"
            className="ui-icon-button"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <DroppableSection
        containerId="today"
        itemIds={todayTasks.map((t) => t.id)}
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5 min-h-0"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement) !== e.currentTarget) return;
          setAdding(true);
        }}
      >
        {todayTasks.length === 0 && !adding && (
          <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-8">
            Nothing planned yet
          </p>
        )}
        {todayTasks.map((task) => (
          <SortableTaskItem
            key={task.id}
            task={task}
            containerId="today"
            showRecurrenceIcon={!!task.recurrentTaskId}
            suffix={task.projectId && task.location !== 'project' ? linkedProjectMarker : undefined}
            onToggle={toggleTask}
            onDoubleClick={(id, anchor) => setPopover({ id, anchor })}
          />
        ))}
        {adding && (
          <InlineTaskInput
            placeholder="Task name…"
            onSubmit={(title) => {
              addTask({ title, location: 'today', date: currentDate });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </DroppableSection>

      {popover && (
        <TaskDetailPopover
          taskId={popover.id}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
