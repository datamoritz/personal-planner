'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeft, Plus } from 'lucide-react';
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  usePlannerStore,
  selectActiveProjects,
  selectFinishedProjects,
  selectProjectTasks,
} from '@/store/usePlannerStore';
import { ProjectCard } from '@/components/ui/ProjectCard';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import type { Project, Tag, Task } from '@/types';

function SortableProjectCard({
  project, tasks, tags, onAddSubtask, onToggleTask, onDoubleClickTask, onFinish, onDelete, onSetTag, isNoteSelected, onSelectForNotes, expanded, onToggleExpanded,
}: {
  project: Project; tasks: Task[]; tags: Tag[];
  onAddSubtask: (pid: string, title: string) => void;
  onToggleTask: (id: string) => void;
  onDoubleClickTask: (id: string, anchor: HTMLElement) => void;
  onFinish: (id: string) => void;
  onDelete: (id: string) => void;
  onSetTag: (projectId: string, tagId: string | undefined) => void;
  isNoteSelected: boolean;
  onSelectForNotes: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    data: { type: 'project' },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      onClick={onSelectForNotes}
      className={[
        'rounded-xl transition-shadow cursor-pointer',
        isNoteSelected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1' : '',
      ].join(' ')}
    >
      {/* drag handle — horizontal dots centered at top of card */}
      <div
        {...attributes}
        {...listeners}
        className="absolute -top-0 left-0 right-0 h-3 flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-50 hover:!opacity-90 transition-opacity z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="20" height="4" viewBox="0 0 20 4" fill="currentColor" className="text-[var(--color-text-muted)]">
          <circle cx="2" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
          <circle cx="12" cy="2" r="1.2"/><circle cx="17" cy="2" r="1.2"/>
        </svg>
      </div>
      <ProjectCard
        project={project} tasks={tasks} tags={tags}
        onAddSubtask={onAddSubtask}
        onToggleTask={onToggleTask}
        onDoubleClickTask={onDoubleClickTask}
        onFinish={onFinish}
        onDelete={onDelete}
        onSetTag={onSetTag}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
      />
    </div>
  );
}

type PopoverState = { id: string; anchor: HTMLElement } | null;

interface ProjectsColumnProps {
  onCollapse?: () => void;
  highlightSelection?: boolean;
}

export function ProjectsColumn({ onCollapse, highlightSelection = false }: ProjectsColumnProps) {
  const { projects, tasks, tags, addProject, deleteProject, addTask, toggleTask, finishProject,
    setProjectTag, activeTagFilter, selectedProjectIdForNotes, setSelectedProjectIdForNotes,
    expandedProjectIds, toggleProjectExpanded } = usePlannerStore();

  const allActive = selectActiveProjects(projects);
  const active = activeTagFilter
    ? allActive.filter((p) => p.tagId === activeTagFilter)
    : allActive;
  const finished = selectFinishedProjects(projects);

  const [addingProject, setAddingProject]   = useState(false);
  const [finishedExpanded, setFinishedExpanded] = useState(false);
  const [popover, setPopover]               = useState<PopoverState>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-[var(--color-border)]">
      <div className="flex h-[52px] items-center justify-end px-2 border-b border-[var(--color-border)] flex-shrink-0">
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse Projects"
            className="ui-icon-button"
          >
            <ChevronsLeft size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="ui-section-label">
            Projects
          </span>
          {active.length > 0 && (
            <span className="text-[9px] font-semibold w-4 h-4 flex items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-muted)]">
              {active.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setAddingProject(true)}
            title="New project"
            className="ui-icon-button"
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Active projects */}
      <div
        className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2.5 min-h-0"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement) !== e.currentTarget) return;
          setAddingProject(true);
        }}
      >
        {addingProject && (
          <InlineTaskInput
            placeholder="Project name…"
            onSubmit={(title) => { addProject(title); setAddingProject(false); }}
            onCancel={() => setAddingProject(false)}
          />
        )}

        {active.length === 0 && !addingProject && (
          <p className="text-xs text-[var(--color-text-muted)] italic text-center mt-4">
            No active projects
          </p>
        )}

        <SortableContext items={active.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {active.map((project) => (
            <div key={project.id} className="relative group">
              <SortableProjectCard
                project={project}
                tasks={selectProjectTasks(tasks, project.id)}
                tags={tags}
                onAddSubtask={(pid, title) => addTask({ title, location: 'project', projectId: pid })}
                onToggleTask={toggleTask}
                onDoubleClickTask={(id, anchor) => setPopover({ id, anchor })}
                onFinish={finishProject}
                onDelete={deleteProject}
                onSetTag={setProjectTag}
                isNoteSelected={highlightSelection && selectedProjectIdForNotes === project.id}
                onSelectForNotes={() => setSelectedProjectIdForNotes(
                  selectedProjectIdForNotes === project.id ? null : project.id
                )}
                expanded={expandedProjectIds.includes(project.id)}
                onToggleExpanded={() => toggleProjectExpanded(project.id)}
              />
            </div>
          ))}
        </SortableContext>
      </div>

      {/* Finished projects */}
      {finished.length > 0 && (
        <div className="border-t border-[var(--color-border)] flex-shrink-0">
          <button
            onClick={() => setFinishedExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
          >
            {finishedExpanded
              ? <ChevronDown size={12} strokeWidth={2.5} />
              : <ChevronRight size={12} strokeWidth={2.5} />}
            <span className="ui-section-label text-inherit">Finished</span>
            <span className="ml-auto text-[10px]">{finished.length}</span>
          </button>

          {finishedExpanded && (
            <div className="px-3 pb-3 flex flex-col gap-2">
              {finished.map((p) => (
                <div
                  key={p.id}
                  className="px-3 py-2 rounded-[0.9rem] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-muted)] line-through"
                >
                  {p.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
