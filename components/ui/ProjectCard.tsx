'use client';

import { ArrowUpRight, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Project, Tag, Task } from '@/types';
import { SortableTaskItem } from '@/components/dnd/SortableTaskItem';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { InlineTaskInput } from './InlineTaskInput';
import { TaskPill } from './TaskPill';

interface ProjectCardProps {
  project: Project;
  tasks: Task[];
  tags?: Tag[];
  onAddSubtask: (projectId: string, title: string) => void;
  onToggleTask: (taskId: string) => void;
  onDoubleClickTask: (taskId: string, anchor: HTMLElement) => void;
  onFinish: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onSetTag?: (projectId: string, tagId: string | undefined) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function ProjectCard({
  project,
  tasks,
  tags = [],
  onAddSubtask,
  onToggleTask,
  onDoubleClickTask,
  onFinish,
  onDelete,
  onSetTag,
  expanded,
  onToggleExpanded,
}: ProjectCardProps) {
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [showFinishedTasks, setShowFinishedTasks] = useState(false);
  const tagBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const progressPct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const totalEstimatedHours = tasks.reduce((sum, task) => sum + (task.estimateHours ?? 0), 0);
  const visibleTasks = showFinishedTasks ? tasks : tasks.filter((t) => t.status !== 'done');

  const projectTag = project.tagId ? tags.find((t) => t.id === project.tagId) : undefined;

  const openTagPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tagBtnRef.current) return;
    const rect = tagBtnRef.current.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 4, left: rect.left });
    setTagPickerOpen(true);
  };

  return (
    <div
      className="ui-raised-surface rounded-[1rem] border border-[var(--color-border-subtle)] bg-[var(--color-canvas)] overflow-hidden"
      style={{
        borderLeftWidth: projectTag ? '4px' : undefined,
        borderLeftColor: projectTag ? projectTag.colorDark : undefined,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div className="group flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onToggleExpanded}
          className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
        >
          {expanded
            ? <ChevronDown size={14} strokeWidth={2.5} />
            : <ChevronRight size={14} strokeWidth={2.5} />}
        </button>

        <span className="flex-1 text-[14px] font-semibold text-[var(--color-text-primary)] truncate">
          {project.title}
        </span>

        {total > 0 && (
          <div className="flex items-center gap-2 whitespace-nowrap">
            {totalEstimatedHours > 0 && (
              <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                {Number.isInteger(totalEstimatedHours) ? totalEstimatedHours : totalEstimatedHours.toFixed(1)}h
              </span>
            )}
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {doneCount}/{total}
            </span>
          </div>
        )}

        {total === 0 && (
          <button
            ref={tagBtnRef}
            onClick={openTagPicker}
            title="Set project color"
            className="flex-shrink-0 h-4 w-4 rounded-full border-2 cursor-pointer transition-colors"
            style={{
              background: projectTag ? projectTag.color : 'transparent',
              borderColor: projectTag ? projectTag.colorDark : 'var(--color-border)',
            }}
          />
        )}

        <button
          onClick={() => setAddingSubtask(true)}
          title="Add subtask"
          className="ui-icon-button flex-shrink-0"
        >
          <Plus size={12} strokeWidth={2.5} />
        </button>
        {(total === 0 || doneCount === total) && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
            title="Delete project"
            className="ui-icon-button ui-icon-button--danger flex-shrink-0 opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mx-3 mb-2 h-px rounded-full bg-[var(--color-border-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Subtasks */}
      {expanded && (
        <SortableContext items={visibleTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <DroppableSection
            containerId={`project-${project.id}`}
            itemIds={visibleTasks.map((t) => t.id)}
            className={`px-2.5 pb-3 flex flex-col gap-1.5 ${visibleTasks.length === 0 ? 'min-h-[5.5rem]' : ''}`}
          >
            {visibleTasks.map((task) => (
              task.location === 'project' ? (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  containerId={`project-${project.id}`}
                  onToggle={onToggleTask}
                  onDoubleClick={onDoubleClickTask}
                />
              ) : (
                <TaskPill
                  key={task.id}
                  task={task}
                  onToggle={onToggleTask}
                  onDoubleClick={onDoubleClickTask}
                  rightAdornment={<ArrowUpRight size={11} className="text-[var(--color-text-muted)] opacity-75" strokeWidth={2.3} />}
                />
              )
            ))}
            {addingSubtask && (
              <InlineTaskInput
                placeholder="Subtask name…"
                onSubmit={(title) => {
                  onAddSubtask(project.id, title);
                  setAddingSubtask(false);
                }}
                onCancel={() => setAddingSubtask(false)}
              />
            )}
            {visibleTasks.length === 0 && !addingSubtask && (
              <div className="flex min-h-[4.5rem] items-center rounded-[0.9rem] border border-dashed border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-surface-secondary)_72%,transparent)] px-3">
                <p className="text-xs text-[var(--color-text-muted)] italic">Drop a task here or add a subtask</p>
              </div>
            )}
            {total > 0 && !addingSubtask && (
              <div className="flex items-center justify-between px-1 pt-1">
                {doneCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowFinishedTasks((value) => !value)}
                    className="text-left text-[10px] font-medium tracking-[0.02em] text-[var(--color-text-muted)] opacity-55 hover:opacity-85 transition-opacity cursor-pointer"
                  >
                    {showFinishedTasks ? 'Hide finished tasks' : 'Show finished tasks'}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  ref={tagBtnRef}
                  type="button"
                  onClick={openTagPicker}
                  title="Set project color"
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full cursor-pointer transition-transform hover:scale-110"
                  style={{
                    background: projectTag ? projectTag.color : 'var(--color-border)',
                  }}
                />
              </div>
            )}
          </DroppableSection>
        </SortableContext>
      )}

      {/* Finish — only when all tasks are done */}
      {expanded && total > 0 && doneCount === total && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onFinish(project.id)}
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-done)] transition-colors cursor-pointer"
          >
            Mark project as finished
          </button>
        </div>
      )}

      {/* Tag picker — fixed positioned to escape overflow:hidden */}
      {tagPickerOpen && pickerPos && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTagPickerOpen(false)}
          />
          <div
            className="fixed z-50 ui-floating-surface flex flex-col gap-1 p-2.5 min-w-[180px]"
            style={{ top: pickerPos.top, left: pickerPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Clear option */}
            <button
              onClick={() => { onSetTag?.(project.id, undefined); setTagPickerOpen(false); }}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] cursor-pointer transition-colors"
            >
              <span className="w-3 h-3 rounded-full border-2 border-[var(--color-border)] flex-shrink-0" />
              None
            </button>
            <div className="border-t border-[var(--color-border-subtle)] my-0.5" />
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => { onSetTag?.(project.id, tag.id); setTagPickerOpen(false); }}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] cursor-pointer transition-colors"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0 border"
                  style={{ background: tag.color, borderColor: tag.colorDark }}
                />
                {tag.name}
                {project.tagId === tag.id && (
                  <svg className="ml-auto" width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
