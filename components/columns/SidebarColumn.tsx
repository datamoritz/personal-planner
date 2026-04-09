'use client';

import { useState } from 'react';
import { ChevronsRight, FolderClosed, Trash2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import * as api from '@/lib/api';
import {
  usePlannerStore,
  selectOverdueTasks,
  selectBacklogTasks,
  selectUpcomingTasks,
  selectRecurrentTasksSorted,
} from '@/store/usePlannerStore';
import { SortableTaskItem } from '@/components/dnd/SortableTaskItem';
import { SortableRecurrentItem } from '@/components/dnd/SortableRecurrentItem';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { RecurrentTaskDetailPopover } from '@/components/ui/RecurrentTaskDetailPopover';

type TaskPopover      = { type: 'task';      id: string; anchor: HTMLElement };
type RecurrentPopover = { type: 'recurrent'; id: string; anchor: HTMLElement };
type PopoverState     = TaskPopover | RecurrentPopover | null;

function formatUpcomingDate(date: string): string {
  const d = parseISO(date);
  if (isToday(d))    return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, 'EEE, MMM d');
}

interface SidebarColumnProps {
  onCollapse?: () => void;
  triggerBacklogAdd?: boolean;
  onBacklogAddHandled?: () => void;
}

function TrashDropTarget() {
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-trash',
    data: { type: 'container', containerId: 'trash' },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      title="Drag a task here to delete"
      className={[
        'ui-icon-button transition-colors',
        isOver
          ? 'text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-300'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      <Trash2 size={13} strokeWidth={2.2} />
    </button>
  );
}

export function SidebarColumn({ onCollapse, triggerBacklogAdd, onBacklogAddHandled }: SidebarColumnProps) {
  const { currentDate, tasks, recurrentTasks, tags, addTask, toggleTask, addRecurrentTask, advanceRecurrentTask, activeTagFilter } = usePlannerStore();

  const overdue  = activeTagFilter
    ? selectOverdueTasks(tasks).filter((t) => t.tagId === activeTagFilter)
    : selectOverdueTasks(tasks);
  const backlog  = activeTagFilter
    ? selectBacklogTasks(tasks).filter((t) => t.tagId === activeTagFilter)
    : selectBacklogTasks(tasks);
  const upcoming = activeTagFilter
    ? selectUpcomingTasks(tasks, currentDate).filter((t) => t.tagId === activeTagFilter)
    : selectUpcomingTasks(tasks, currentDate);
  const recurrent = selectRecurrentTasksSorted(recurrentTasks);

  const hasOverdue = overdue.length > 0;

  const [addingBacklog, setAddingBacklog]     = useState(false);
  const [addingRecurrent, setAddingRecurrent] = useState(false);
  const [popover, setPopover]                 = useState<PopoverState>(null);
  const backlogInputOpen = addingBacklog || !!triggerBacklogAdd;
  const linkedProjectMarker = <FolderClosed size={11} className="text-[var(--color-text-muted)] opacity-75" strokeWidth={2.2} />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {onCollapse && (
        <div className="flex h-[52px] items-center justify-between px-2 border-b border-[var(--color-border)] flex-shrink-0">
          <button
            onClick={onCollapse}
            title="Collapse Sidebar"
            className="ui-icon-button"
          >
            <ChevronsRight size={12} strokeWidth={2.5} />
          </button>
          <TrashDropTarget />
        </div>
      )}
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="vertical" className="h-full">

          {/* ── Overdue (conditional) ─────────────────────────── */}
          {hasOverdue && (
            <>
              <Panel defaultSize={22} minSize={12}>
                <div className="flex flex-col h-full overflow-hidden">
                  <SectionHeader
                    title="Overdue"
                    count={overdue.length}
                    className="flex-shrink-0"
                  />
                  <DroppableSection
                    containerId="overdue"
                    itemIds={overdue.map((t) => t.id)}
                    className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5 min-h-0"
                  >
                    {overdue.map((task) => (
                      <SortableTaskItem
                        key={task.id}
                        task={task}
                        containerId="overdue"
                        isOverdue
                        suffix={task.projectId && task.location !== 'project' ? linkedProjectMarker : undefined}
                        onToggle={toggleTask}
                        onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                      />
                    ))}
                  </DroppableSection>
                </div>
              </Panel>
              <PanelResizeHandle className="h-px bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors data-[resize-handle-active]:bg-[var(--color-accent)] cursor-row-resize" />
            </>
          )}

          {/* ── Back Log ──────────────────────────────────────── */}
          <Panel defaultSize={hasOverdue ? 23 : 32} minSize={12}>
            <div className="flex flex-col h-full overflow-hidden">
              <SectionHeader
                title="Back Log"
                count={backlog.length}
                onAdd={() => setAddingBacklog(true)}
                addLabel="Add to backlog"
                className="flex-shrink-0"
              />
              <DroppableSection
                containerId="backlog"
                itemIds={backlog.map((t) => t.id)}
                className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5 min-h-0"
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement) !== e.currentTarget) return;
                  setAddingBacklog(true);
                }}
              >
                {backlog.length === 0 && !backlogInputOpen && (
                  <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">Empty backlog</p>
                )}
                {backlog.map((task) => (
                  <SortableTaskItem
                    key={task.id}
                    task={task}
                    containerId="backlog"
                    suffix={task.projectId && task.location !== 'project' ? linkedProjectMarker : undefined}
                    onToggle={toggleTask}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                  />
                ))}
                {backlogInputOpen && (
                  <InlineTaskInput
                    placeholder="Backlog task…"
                    onSubmit={(title) => {
                      addTask({ title, location: 'backlog' });
                      setAddingBacklog(false);
                      onBacklogAddHandled?.();
                    }}
                    onCancel={() => {
                      setAddingBacklog(false);
                      onBacklogAddHandled?.();
                    }}
                  />
                )}
              </DroppableSection>
            </div>
          </Panel>

          <PanelResizeHandle className="h-px bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors data-[resize-handle-active]:bg-[var(--color-accent)] cursor-row-resize" />

          {/* ── Upcoming ──────────────────────────────────────── */}
          <Panel defaultSize={hasOverdue ? 23 : 34} minSize={12}>
            <div className="flex flex-col h-full overflow-hidden">
              <SectionHeader
                title="Upcoming"
                count={upcoming.length}
                className="flex-shrink-0"
              />
              <DroppableSection
                containerId="upcoming"
                itemIds={upcoming.map((t) => t.id)}
                className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5 min-h-0"
              >
                {upcoming.length === 0 && (
                  <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">Nothing upcoming</p>
                )}
                {upcoming.map((task) => (
                  <SortableTaskItem
                    key={task.id}
                    task={task}
                    containerId="upcoming"
                    topLabel={task.date ? formatUpcomingDate(task.date) : undefined}
                    suffix={task.projectId && task.location !== 'project' ? linkedProjectMarker : undefined}
                    onToggle={toggleTask}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                  />
                ))}
              </DroppableSection>
            </div>
          </Panel>

          <PanelResizeHandle className="h-px bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors data-[resize-handle-active]:bg-[var(--color-accent)] cursor-row-resize" />

          {/* ── Recurrent ─────────────────────────────────────── */}
          <Panel defaultSize={hasOverdue ? 32 : 34} minSize={12}>
            <div className="flex flex-col h-full overflow-hidden">
              <SectionHeader
                title="Recurrent"
                count={recurrent.length}
                onAdd={() => setAddingRecurrent(true)}
                addLabel="Add recurrent task"
                className="flex-shrink-0"
              />
              <div
                className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5 min-h-0"
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement) !== e.currentTarget) return;
                  setAddingRecurrent(true);
                }}
              >
                {recurrent.length === 0 && !addingRecurrent && (
                  <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">No recurrent tasks</p>
                )}
                {recurrent.map((rt) => {
                  const tag = rt.tagId ? tags.find((candidate) => candidate.id === rt.tagId) : undefined;
                  const isCompleted = api.isRecurrentCycleComplete(
                    rt.frequency,
                    rt.anchorDate,
                    rt.completedThroughDate,
                  );
                  return (
                    <SortableRecurrentItem
                      key={rt.id}
                      task={rt}
                      isCompleted={isCompleted}
                      accentColor={tag?.color}
                      accentColorDark={tag?.colorDark}
                      onToggle={advanceRecurrentTask}
                      onDoubleClick={(id, anchor) => setPopover({ type: 'recurrent', id, anchor })}
                    />
                  );
                })}
                {addingRecurrent && (
                  <InlineTaskInput
                    placeholder="Recurrent task name…"
                    onSubmit={(title) => {
                      addRecurrentTask({ title, frequency: { type: 'daily' } });
                      setAddingRecurrent(false);
                    }}
                    onCancel={() => setAddingRecurrent(false)}
                  />
                )}
              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.type === 'recurrent' && (
        <RecurrentTaskDetailPopover
          recurrentTaskId={popover.id}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
