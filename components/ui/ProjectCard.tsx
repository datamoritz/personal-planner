'use client';

import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Project, Task } from '@/types';
import { SortableTaskItem } from '@/components/dnd/SortableTaskItem';
import { DroppableSection } from '@/components/dnd/DroppableSection';
import { InlineTaskInput } from './InlineTaskInput';

interface ProjectCardProps {
  project: Project;
  tasks: Task[];
  onAddSubtask: (projectId: string, title: string) => void;
  onToggleTask: (taskId: string) => void;
  onDoubleClickTask: (taskId: string, anchor: HTMLElement) => void;
  onFinish: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

export function ProjectCard({
  project,
  tasks,
  onAddSubtask,
  onToggleTask,
  onDoubleClickTask,
  onFinish,
  onDelete,
}: ProjectCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [addingSubtask, setAddingSubtask] = useState(false);

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const progressPct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <div className="group flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
        >
          {expanded
            ? <ChevronDown size={14} strokeWidth={2.5} />
            : <ChevronRight size={14} strokeWidth={2.5} />}
        </button>

        <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {project.title}
        </span>

        {total > 0 && (
          <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
            {doneCount}/{total}
          </span>
        )}

        <button
          onClick={() => setAddingSubtask(true)}
          title="Add subtask"
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
        >
          <Plus size={12} strokeWidth={2.5} />
        </button>
        {(total === 0 || doneCount === total) && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
            title="Delete project"
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-red-500 hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mx-3 mb-2 h-0.5 rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Subtasks */}
      {expanded && (
        <DroppableSection
          containerId={`project-${project.id}`}
          itemIds={tasks.map((t) => t.id)}
          className="px-2 pb-2 flex flex-col gap-1"
        >
          {tasks.map((task) => (
            <SortableTaskItem
              key={task.id}
              task={task}
              containerId={`project-${project.id}`}
              onToggle={onToggleTask}
              onDoubleClick={onDoubleClickTask}
            />
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
          {tasks.length === 0 && !addingSubtask && (
            <p className="px-1 py-1 text-xs text-[var(--color-text-muted)] italic">No subtasks yet</p>
          )}
        </DroppableSection>
      )}

      {/* Finish — only when all tasks are done */}
      {expanded && total > 0 && doneCount === total && (
        <div className="px-3 pb-2.5">
          <button
            onClick={() => onFinish(project.id)}
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-done)] transition-colors cursor-pointer"
          >
            Mark project as finished
          </button>
        </div>
      )}
    </div>
  );
}
