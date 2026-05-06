'use client';

import { useState } from 'react';
import { ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import {
  usePlannerStore,
  selectOverdueTasks,
  selectBacklogTasks,
  selectUpcomingTasks,
  selectRecurrentTasksSorted,
} from '@/store/usePlannerStore';
import * as api from '@/lib/api';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { RecurrentTaskDetailPopover } from '@/components/ui/RecurrentTaskDetailPopover';
import type { Task } from '@/types';

type SheetTab = 'projects' | 'backlog' | 'upcoming' | 'recurrent';

const TABS: { label: string; value: SheetTab }[] = [
  { label: 'Projects',  value: 'projects' },
  { label: 'Backlog',   value: 'backlog' },
  { label: 'Upcoming',  value: 'upcoming' },
  { label: 'Recurrent', value: 'recurrent' },
];

interface MobileProjectsSheetProps {
  onClose: () => void;
}

function formatUpcomingDate(date: string): string {
  const d = parseISO(date);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, 'EEE, MMM d');
}

function TaskRow({
  task,
  isOverdue,
  showDate,
  onToggle,
  onDetail,
}: {
  task: Task;
  isOverdue?: boolean;
  showDate?: boolean;
  onToggle: () => void;
  onDetail: (anchor: HTMLElement) => void;
}) {
  return (
    <div className={[
      'flex items-center gap-2.5 px-3 py-2 rounded-[0.875rem] border',
      isOverdue
        ? 'bg-[var(--color-overdue-subtle)] border-[var(--color-overdue)]/20'
        : 'bg-[var(--color-task-pill)] border-[var(--color-task-pill-border)]',
    ].join(' ')}>
      <button
        type="button"
        onClick={onToggle}
        className={[
          'flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 transition-colors',
          task.status === 'done'
            ? 'bg-[var(--color-done)] border-[var(--color-done)]'
            : isOverdue
              ? 'border-[var(--color-overdue)]'
              : 'border-[var(--color-text-muted)]',
        ].join(' ')}
      />
      <div className="flex-1 min-w-0">
        {showDate && task.date && (
          <div className="text-[10px] font-medium text-[var(--color-text-muted)] leading-none mb-0.5">
            {formatUpcomingDate(task.date)}
          </div>
        )}
        <span className={[
          'text-[13px] truncate block',
          task.status === 'done'
            ? 'line-through text-[var(--color-text-muted)]'
            : isOverdue
              ? 'text-[var(--color-overdue)]'
              : 'text-[var(--color-text-primary)]',
        ].join(' ')}>
          {task.title}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => onDetail(e.currentTarget)}
        className="flex-shrink-0 ui-icon-button"
      >
        <MoreHorizontal size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

export function MobileProjectsSheet({ onClose }: MobileProjectsSheetProps) {
  const [tab, setTab]                       = useState<SheetTab>('projects');
  const [addingBacklog, setAddingBacklog]   = useState(false);
  const [addingRecurrent, setAddingRecurrent] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<
    | { type: 'task'; id: string; anchor: HTMLElement }
    | { type: 'recurrent'; id: string; anchor: HTMLElement }
    | null
  >(null);

  const {
    currentDate, tasks, recurrentTasks, projects, tags,
    addTask, toggleTask, advanceRecurrentTask, addRecurrentTask,
  } = usePlannerStore();

  const overdue        = selectOverdueTasks(tasks);
  const backlog        = selectBacklogTasks(tasks);
  const upcoming       = selectUpcomingTasks(tasks, currentDate);
  const recurrent      = selectRecurrentTasksSorted(recurrentTasks);
  const activeProjects = projects.filter((p) => p.status === 'active');

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[200] bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[201] flex flex-col rounded-t-[1.5rem] bg-[var(--color-canvas)] border-t border-[var(--color-border)] max-h-[82dvh] sheet-enter shadow-[0_-8px_40px_rgba(0,0,0,0.14)]">
        {/* Handle + close */}
        <div className="relative flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-8 h-[3px] rounded-full bg-[var(--color-border)]" />
          <button type="button" onClick={onClose} className="ui-icon-button absolute right-4 top-1.5">
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-shrink-0 border-b border-[var(--color-border)]">
          {TABS.map((t) => {
            const isActive = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={[
                  'flex-1 py-2.5 text-[11px] transition-colors',
                  isActive
                    ? 'font-semibold text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                    : 'font-medium text-[var(--color-text-muted)]',
                ].join(' ')}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">

          {/* ── Projects tab ──────────────────────────────── */}
          {tab === 'projects' && (
            <>
              {activeProjects.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-6">No active projects</p>
              )}
              {activeProjects.map((project) => {
                const tag = project.tagId ? tags.find((t) => t.id === project.tagId) : undefined;
                const projectTasks = tasks.filter((t) => t.projectId === project.id && t.location === 'project');
                const remaining = projectTasks.filter((t) => t.status !== 'done').length;
                const isExpanded = expandedProjects.has(project.id);

                return (
                  <div key={project.id}>
                    <button
                      type="button"
                      onClick={() => toggleProject(project.id)}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-[0.875rem] bg-[var(--color-surface)] border border-[var(--color-border)] text-left transition-colors active:bg-[var(--color-surface-raised)]"
                      style={tag ? { borderLeftColor: tag.colorDark, borderLeftWidth: '3px' } : {}}
                    >
                      <ChevronDown
                        size={13}
                        strokeWidth={2.2}
                        className={`flex-shrink-0 text-[var(--color-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                      />
                      <span className="flex-1 text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                        {project.title}
                      </span>
                      {projectTasks.length > 0 && (
                        <span className="text-[11px] text-[var(--color-text-muted)] flex-shrink-0 tabular-nums">
                          {remaining} left
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="pl-3 mt-1 mb-0.5 flex flex-col gap-1">
                        {projectTasks.length === 0 && (
                          <p className="text-[12px] text-[var(--color-text-muted)] italic py-1 px-2">No tasks</p>
                        )}
                        {projectTasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            onToggle={() => toggleTask(task.id)}
                            onDetail={(anchor) => setPopover({ type: 'task', id: task.id, anchor })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ── Backlog tab ───────────────────────────────── */}
          {tab === 'backlog' && (
            <>
              {overdue.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-overdue)] mt-1 mb-0.5">
                    Overdue
                  </p>
                  {overdue.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isOverdue
                      onToggle={() => toggleTask(task.id)}
                      onDetail={(anchor) => setPopover({ type: 'task', id: task.id, anchor })}
                    />
                  ))}
                  <div className="h-px bg-[var(--color-border)] my-1" />
                </>
              )}
              {backlog.length === 0 && !addingBacklog && overdue.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-6">Empty backlog</p>
              )}
              {backlog.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggleTask(task.id)}
                  onDetail={(anchor) => setPopover({ type: 'task', id: task.id, anchor })}
                />
              ))}
              {addingBacklog && (
                <InlineTaskInput
                  placeholder="Backlog task…"
                  onSubmit={(title) => { addTask({ title, location: 'backlog' }); setAddingBacklog(false); }}
                  onCancel={() => setAddingBacklog(false)}
                />
              )}
              <button
                type="button"
                onClick={() => setAddingBacklog(true)}
                className="flex items-center gap-2 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mt-1"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add to backlog
              </button>
            </>
          )}

          {/* ── Upcoming tab ──────────────────────────────── */}
          {tab === 'upcoming' && (
            <>
              {upcoming.length === 0 && (
                <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-6">Nothing upcoming</p>
              )}
              {upcoming.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showDate
                  onToggle={() => toggleTask(task.id)}
                  onDetail={(anchor) => setPopover({ type: 'task', id: task.id, anchor })}
                />
              ))}
            </>
          )}

          {/* ── Recurrent tab ─────────────────────────────── */}
          {tab === 'recurrent' && (
            <>
              {recurrent.length === 0 && !addingRecurrent && (
                <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-6">No recurrent tasks</p>
              )}
              {recurrent.map((rt) => {
                const tag = rt.tagId ? tags.find((t) => t.id === rt.tagId) : undefined;
                const isCompleted = api.isRecurrentCycleComplete(rt.frequency, rt.anchorDate, rt.completedThroughDate);
                return (
                  <div
                    key={rt.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-[0.875rem] bg-[var(--color-task-pill)] border border-[var(--color-task-pill-border)]"
                    style={tag ? { borderColor: tag.colorDark + '33', backgroundColor: tag.color + '20' } : {}}
                  >
                    <button
                      type="button"
                      onClick={() => advanceRecurrentTask(rt.id)}
                      className={[
                        'flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 transition-colors',
                        isCompleted ? 'bg-[var(--color-done)] border-[var(--color-done)]' : 'border-[var(--color-text-muted)]',
                      ].join(' ')}
                    />
                    <span className={[
                      'flex-1 text-[13px] truncate',
                      isCompleted ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
                    ].join(' ')}>
                      {rt.title}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => setPopover({ type: 'recurrent', id: rt.id, anchor: e.currentTarget })}
                      className="flex-shrink-0 ui-icon-button"
                    >
                      <MoreHorizontal size={14} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
              {addingRecurrent && (
                <InlineTaskInput
                  placeholder="Recurrent task name…"
                  onSubmit={(title) => { addRecurrentTask({ title, frequency: { type: 'daily' } }); setAddingRecurrent(false); }}
                  onCancel={() => setAddingRecurrent(false)}
                />
              )}
              <button
                type="button"
                onClick={() => setAddingRecurrent(true)}
                className="flex items-center gap-2 py-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors mt-1"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add recurrent task
              </button>
            </>
          )}
        </div>
      </div>

      {popover?.type === 'task' && (
        <TaskDetailPopover taskId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
      {popover?.type === 'recurrent' && (
        <RecurrentTaskDetailPopover recurrentTaskId={popover.id} anchor={popover.anchor} onClose={() => setPopover(null)} />
      )}
    </>
  );
}
