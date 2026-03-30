'use client';

import { useEffect, useState } from 'react';
import { ChevronsRight } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
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

export function SidebarColumn({ onCollapse, triggerBacklogAdd, onBacklogAddHandled }: SidebarColumnProps) {
  const { currentDate, tasks, recurrentTasks, addTask, toggleTask, addRecurrentTask, activeTagFilter } = usePlannerStore();

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

  useEffect(() => {
    if (triggerBacklogAdd) {
      setAddingBacklog(true);
      onBacklogAddHandled?.();
    }
  }, [triggerBacklogAdd]); // eslint-disable-line react-hooks/exhaustive-deps
  const [addingRecurrent, setAddingRecurrent] = useState(false);
  const [popover, setPopover]                 = useState<PopoverState>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {onCollapse && (
        <div className="flex items-center justify-start px-2 py-1 border-b border-[var(--color-border)] flex-shrink-0">
          <button
            onClick={onCollapse}
            title="Collapse Sidebar"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
          >
            <ChevronsRight size={12} strokeWidth={2.5} />
          </button>
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
                    className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 min-h-0"
                  >
                    {overdue.map((task) => (
                      <SortableTaskItem
                        key={task.id}
                        task={task}
                        containerId="overdue"
                        isOverdue
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
                className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 min-h-0"
              >
                {backlog.length === 0 && !addingBacklog && (
                  <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">Empty backlog</p>
                )}
                {backlog.map((task) => (
                  <SortableTaskItem
                    key={task.id}
                    task={task}
                    containerId="backlog"
                    onToggle={toggleTask}
                    onDoubleClick={(id, anchor) => setPopover({ type: 'task', id, anchor })}
                  />
                ))}
                {addingBacklog && (
                  <InlineTaskInput
                    placeholder="Backlog task…"
                    onSubmit={(title) => { addTask({ title, location: 'backlog' }); setAddingBacklog(false); }}
                    onCancel={() => setAddingBacklog(false)}
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
                className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 min-h-0"
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
              <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 min-h-0">
                {recurrent.length === 0 && !addingRecurrent && (
                  <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">No recurrent tasks</p>
                )}
                {recurrent.map((rt) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const hasActive = tasks.some(
                    (t) =>
                      t.recurrentTaskId === rt.id &&
                      t.status === 'pending' &&
                      (t.location === 'today' || t.location === 'myday' || t.location === 'upcoming') &&
                      (!t.date || t.date >= today)
                  );
                  return (
                    <SortableRecurrentItem
                      key={rt.id}
                      task={rt}
                      hasActiveInstance={hasActive}
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
