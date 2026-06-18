'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  FolderPlus,
  GripVertical,
  MilestoneIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import { addDays, differenceInCalendarDays, format, isSameYear, parseISO } from 'date-fns';
import {
  createProject,
  createGoal,
  createMilestone,
  deleteGoal,
  deleteMilestone,
  deleteProject,
  fetchPlanner,
  patchGoal,
  patchMilestone,
  patchProject,
  type PlannerData,
} from '@/lib/api';
import {
  buildPlannerSegments,
  clampDateToYear,
  dateToPercent,
  getPlannerYearBounds,
  rangeToPercent,
  xToDate,
} from '@/lib/plannerTimeline';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { Goal, Milestone, MilestoneType, PlannerZoom, Project } from '@/types';
import { DetailPopover } from '@/components/ui/DetailPopover';
import { PopoverField, PopoverInput } from '@/components/ui/PopoverField';

type PlannerRow =
  | { id: string; kind: 'goal'; goal: Goal; height: number }
  | { id: string; kind: 'project'; goal: Goal | null; project: Project; height: number }
  | { id: string; kind: 'add-project'; goal: Goal; height: number }
  | { id: string; kind: 'unassigned-label'; height: number }
  | { id: string; kind: 'group-gap'; height: number };

type PlannerInteraction =
  | {
      kind: 'goal';
      mode: 'move' | 'resize-start' | 'resize-end';
      backendId: number;
      originX: number;
      rectLeft: number;
      rectWidth: number;
      initialStart: string;
      initialEnd: string;
      snapshot: PlannerData;
    }
  | {
      kind: 'project';
      mode: 'move' | 'resize-start' | 'resize-end';
      backendId: number;
      originX: number;
      rectLeft: number;
      rectWidth: number;
      initialStart: string;
      initialEnd: string;
      snapshot: PlannerData;
    };

const LABEL_WIDTH = 320;
const TIMELINE_MIN_WIDTH: Record<PlannerZoom, number> = {
  detail: 11200,
  week: 1680,
  month: 1120,
  quarter: 980,
};

const GOAL_COLORS = [
  '#5b6cff',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const normalized = clean.length === 3
    ? clean.split('').map((char) => `${char}${char}`).join('')
    : clean;
  const num = Number.parseInt(normalized, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function plannerBarStyle(color: string, alpha: number) {
  return {
    background: `linear-gradient(135deg, ${hexToRgba(color, alpha)}, ${hexToRgba(color, alpha * 0.78)})`,
    borderColor: hexToRgba(color, 0.18),
  };
}

function isProjectOutsideGoal(project: Project, goal: Goal | null): boolean {
  if (!goal || !project.startDate || !project.endDate) return false;
  return project.startDate < goal.startDate || project.endDate > goal.endDate;
}

function bucketKey(goalId: number | null | undefined): string {
  return goalId == null ? 'unassigned' : `goal-${goalId}`;
}

function buildRows(goals: Goal[], projects: Project[], collapsedGoalIds: Set<number>): PlannerRow[] {
  const byGoalId = new Map<number, Project[]>();
  const unassigned: Project[] = [];

  for (const project of projects) {
    if (project.goalId == null) {
      unassigned.push(project);
      continue;
    }
    const current = byGoalId.get(project.goalId) ?? [];
    current.push(project);
    byGoalId.set(project.goalId, current);
  }

  const rows: PlannerRow[] = [];
  for (const goal of goals) {
    rows.push({ id: `goal-${goal.id}`, kind: 'goal', goal, height: 90 });
    if (goal.backendId != null && collapsedGoalIds.has(goal.backendId)) {
      rows.push({ id: `goal-gap-${goal.id}`, kind: 'group-gap', height: 10 });
      continue;
    }
    const goalProjects = [...(byGoalId.get(goal.backendId ?? -1) ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    for (const project of goalProjects) {
      const hasMilestones = goal.milestones.some((milestone) => milestone.projectId === project.backendId);
      rows.push({ id: `project-${project.id}`, kind: 'project', goal, project, height: hasMilestones ? 64 : 42 });
    }
    rows.push({ id: `goal-add-${goal.id}`, kind: 'add-project', goal, height: 42 });
    rows.push({ id: `goal-gap-${goal.id}`, kind: 'group-gap', height: 10 });
  }

  rows.push({ id: 'unassigned-label', kind: 'unassigned-label', height: 42 });
  for (const project of [...unassigned].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    rows.push({ id: `project-${project.id}`, kind: 'project', goal: null, project, height: 42 });
  }

  return rows;
}

function getMilestoneLabelLayoutMap(
  milestones: Milestone[],
): Map<string, { lane: number; offset: number }> {
  const sorted = [...milestones].sort((a, b) => a.date.localeCompare(b.date));
  const layoutById = new Map<string, { lane: number; offset: number }>();
  const clusters: Milestone[][] = [];
  let currentCluster: Milestone[] = [];
  let previousDate: Date | null = null;

  for (const milestone of sorted) {
    const currentDate = parseISO(milestone.date);
    const isCloseToPrevious = previousDate
      ? Math.abs(differenceInCalendarDays(currentDate, previousDate)) <= 24
      : false;

    if (!currentCluster.length || isCloseToPrevious) {
      currentCluster.push(milestone);
    } else {
      clusters.push(currentCluster);
      currentCluster = [milestone];
    }
    previousDate = currentDate;
  }

  if (currentCluster.length) clusters.push(currentCluster);

  for (const cluster of clusters) {
    const offsets =
      cluster.length <= 1
        ? [0]
        : cluster.length === 2
          ? [-58, 58]
          : cluster.length === 3
            ? [-72, 0, 72]
            : [-92, -30, 30, 92];

    cluster.forEach((milestone, index) => {
      layoutById.set(milestone.id, {
        lane: 0,
        offset: offsets[Math.min(index, offsets.length - 1)] ?? 0,
      });
    });
  }

  return layoutById;
}

function TimelinePlaceholder({
  label,
  onClick,
}: {
  label: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="absolute inset-y-0 left-5 flex items-center">
      <button
        type="button"
        onClick={onClick}
        className={[
          'rounded-full border border-[var(--color-border)]/65 bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase',
          onClick ? 'transition hover:border-[var(--color-accent)]/35 hover:text-[var(--color-text-secondary)]' : '',
        ].join(' ')}
      >
        {label}
      </button>
    </div>
  );
}

function reorderProjects(
  projects: Project[],
  activeProjectId: string,
  targetGoalId: number | null,
  overProjectId: string | null,
): Project[] {
  const active = projects.find((project) => project.id === activeProjectId);
  if (!active) return projects;

  const groups = new Map<string, Project[]>();
  for (const project of projects) {
    const key = bucketKey(project.goalId ?? null);
    const current = groups.get(key) ?? [];
    current.push({ ...project });
    groups.set(key, current);
  }

  for (const groupProjects of groups.values()) {
    groupProjects.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const sourceKey = bucketKey(active.goalId ?? null);
  const destinationKey = bucketKey(targetGoalId);
  const sourceList = [...(groups.get(sourceKey) ?? [])];
  const sourceWithoutActive = sourceList.filter((project) => project.id !== activeProjectId);
  groups.set(sourceKey, sourceWithoutActive);

  const destinationBase = sourceKey === destinationKey
    ? sourceWithoutActive
    : [...(groups.get(destinationKey) ?? [])];

  let insertIndex = destinationBase.length;
  if (overProjectId) {
    const overIndex = destinationBase.findIndex((project) => project.id === overProjectId);
    if (overIndex >= 0) insertIndex = overIndex;
  }

  const movedProject: Project = {
    ...active,
    goalId: targetGoalId ?? undefined,
  };
  destinationBase.splice(insertIndex, 0, movedProject);
  groups.set(destinationKey, destinationBase);

  const updates = new Map<string, Project>();
  for (const [key, groupProjects] of groups.entries()) {
    const nextGoalId = key === 'unassigned'
      ? undefined
      : Number.parseInt(key.replace('goal-', ''), 10);
    groupProjects.forEach((project, index) => {
      updates.set(project.id, {
        ...project,
        goalId: Number.isNaN(nextGoalId) ? undefined : nextGoalId,
        sortOrder: index,
      });
    });
  }

  return projects.map((project) => updates.get(project.id) ?? project);
}

function collectChangedProjects(before: Project[], after: Project[]): Project[] {
  const previous = new Map(before.map((project) => [project.id, project]));
  return after.filter((project) => {
    const current = previous.get(project.id);
    if (!current) return false;
    return (
      (current.goalId ?? null) !== (project.goalId ?? null)
      || (current.sortOrder ?? 0) !== (project.sortOrder ?? 0)
      || current.startDate !== project.startDate
      || current.endDate !== project.endDate
    );
  });
}

function rehomeProjectMilestones(
  goals: Goal[],
  projectBackendId: number,
  targetGoalId: number | null,
): Goal[] {
  const projectMilestones = goals
    .flatMap((goal) => goal.milestones)
    .filter((milestone) => milestone.projectId === projectBackendId);
  if (!projectMilestones.length) return goals;

  if (targetGoalId == null) {
    return goals.map((goal) => ({
      ...goal,
      milestones: goal.milestones.map((milestone) =>
        milestone.projectId === projectBackendId
          ? { ...milestone, projectId: undefined }
          : milestone,
      ),
    }));
  }

  return goals.map((goal) => {
    const remaining = goal.milestones.filter((milestone) => milestone.projectId !== projectBackendId);
    if (goal.backendId !== targetGoalId) return { ...goal, milestones: remaining };
    return {
      ...goal,
      milestones: [
        ...remaining,
        ...projectMilestones.map((milestone) => ({ ...milestone, goalId: targetGoalId })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
}

function shiftRangeWithinYear(startDate: string, endDate: string, deltaDays: number, year: number) {
  const { start: yearStart, end: yearEnd } = getPlannerYearBounds(year);
  let start = addDays(parseISO(startDate), deltaDays);
  let end = addDays(parseISO(endDate), deltaDays);

  if (start < yearStart) {
    const shift = differenceInCalendarDays(yearStart, start);
    start = addDays(start, shift);
    end = addDays(end, shift);
  }

  if (end > yearEnd) {
    const shift = differenceInCalendarDays(end, yearEnd);
    start = addDays(start, -shift);
    end = addDays(end, -shift);
  }

  return {
    startDate: format(clampDateToYear(start, year), 'yyyy-MM-dd'),
    endDate: format(clampDateToYear(end, year), 'yyyy-MM-dd'),
  };
}

function SortableProjectLabelRow({
  row,
  isGhosted = false,
  onOpen,
}: {
  row: Extract<PlannerRow, { kind: 'project' }>;
  isGhosted?: boolean;
  onOpen: (anchor: HTMLElement) => void;
}) {
  const outside = isProjectOutsideGoal(row.project, row.goal);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: row.id,
    data: {
      type: 'planner-project',
      projectId: row.project.id,
      goalId: row.goal?.backendId ?? null,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-2 border-b border-[var(--color-border)]/40 px-4"
      style={{
        height: row.height,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging || isGhosted ? 0.2 : 1,
        zIndex: isDragging ? 30 : 'auto',
        position: 'relative',
        background: isDragging ? 'var(--color-surface)' : undefined,
      }}
    >
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
        aria-label={`Reorder ${row.project.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className="text-[var(--color-text-muted)]">↳</span>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        className="min-w-0 flex-1 rounded-lg text-left transition hover:bg-[var(--color-surface)]/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/30"
      >
        <div className="flex items-center gap-2 text-[13px]">
          <div className="min-w-0 truncate text-[var(--color-text-primary)]">
            {row.project.title}
          </div>
          <div className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
            {outside ? 'Outside goal' : row.project.startDate && row.project.endDate
              ? `${format(parseISO(row.project.startDate), 'MMM d')} - ${format(parseISO(row.project.endDate), 'MMM d')}`
              : 'No timeline'}
          </div>
        </div>
      </button>
    </div>
  );
}

function PlannerProjectDragOverlay({
  row,
}: {
  row: Extract<PlannerRow, { kind: 'project' }>;
}) {
  const outside = isProjectOutsideGoal(row.project, row.goal);
  const color = outside ? '#f59e0b' : row.goal?.color ?? '#94a3b8';

  return (
    <div
      className="grid w-[44rem] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-canvas)] shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
      style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}
    >
      <div className="flex items-center gap-2 border-r border-[var(--color-border)] px-4" style={{ height: row.height }}>
        <span className="text-[var(--color-text-muted)]">↳</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px]">
            <div className="min-w-0 truncate text-[var(--color-text-primary)]">
              {row.project.title}
            </div>
            <div className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
              {outside ? 'Outside goal' : row.project.startDate && row.project.endDate
                ? `${format(parseISO(row.project.startDate), 'MMM d')} - ${format(parseISO(row.project.endDate), 'MMM d')}`
                : 'No timeline'}
            </div>
          </div>
        </div>
      </div>
      <div className="relative bg-[var(--color-canvas)]" style={{ height: row.height }}>
        {row.project.startDate && row.project.endDate ? (
          <TimelineBar
            left={0.08}
            width={0.58}
            thickness={6}
            color={color}
          />
        ) : (
          <TimelinePlaceholder label="No range" />
        )}
      </div>
    </div>
  );
}

function GoalLabelRow({
  row,
  collapsed,
  onToggleCollapsed,
  onDelete,
}: {
  row: Extract<PlannerRow, { kind: 'goal' }>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 border-y border-[var(--color-border)]/70 bg-[var(--color-surface)]/28 px-3"
      style={{ height: row.height, boxShadow: `inset 3px 0 0 ${hexToRgba(row.goal.color, 0.55)}` }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.goal.name}`}
        aria-expanded={!collapsed}
      >
        <ChevronDown
          size={14}
          className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: row.goal.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <div className="min-w-0 truncate font-semibold text-[var(--color-text-primary)]">
            {row.goal.name}
          </div>
          <div className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
            {format(parseISO(row.goal.startDate), 'MMM d')} - {format(parseISO(row.goal.endDate), 'MMM d')}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="ui-icon-button ui-icon-button--danger opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete ${row.goal.name}`}
        title="Delete goal"
      >
        <Trash2 size={12} strokeWidth={2.25} />
      </button>
    </div>
  );
}

function PlannerBucketDropRow({
  id,
  goalId,
  height,
  children,
  className,
}: {
  id: string;
  goalId: number | null;
  height: number;
  children: ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      type: 'planner-bucket',
      goalId,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={[className, isOver ? 'bg-[var(--color-surface)]/80' : ''].filter(Boolean).join(' ')}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function TimelineBar({
  left,
  width,
  thickness,
  color,
  onMoveStart,
  onResizeStart,
  onResizeEnd,
}: {
  left: number;
  width: number;
  thickness: number;
  color: string;
  onMoveStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2"
      style={{
        left: `${left * 100}%`,
        width: `${width * 100}%`,
        height: Math.max(24, thickness + 12),
      }}
    >
      <div
        className="absolute left-0 right-0 top-1/2 rounded-full border shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
        style={{
          ...plannerBarStyle(color, thickness > 8 ? 0.94 : 0.3),
          height: thickness,
          transform: 'translateY(-50%)',
        }}
      />
      {onResizeStart && (
        <button
          type="button"
          aria-label="Resize start"
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
          onPointerDown={onResizeStart}
        />
      )}
      {onMoveStart && (
        <button
          type="button"
          aria-label="Move bar"
          className="absolute inset-y-0 left-2 right-2 cursor-grab active:cursor-grabbing"
          onPointerDown={onMoveStart}
        />
      )}
      {onResizeEnd && (
        <button
          type="button"
          aria-label="Resize end"
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
          onPointerDown={onResizeEnd}
        />
      )}
    </div>
  );
}

function MilestoneMarker({
  milestone,
  year,
  lane = 0,
  labelOffset = 0,
  onEdit,
}: {
  milestone: Milestone;
  year: number;
  lane?: number;
  labelOffset?: number;
  onEdit?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `milestone-${milestone.id}`,
    data: {
      type: 'planner-milestone',
      milestoneId: milestone.id,
      backendId: milestone.backendId,
      goalId: milestone.goalId,
      projectId: milestone.projectId ?? null,
      date: milestone.date,
    },
  });
  const left = dateToPercent(milestone.date, year) * 100;
  const labelPositionClass = lane === 0 ? '-top-6' : '-top-6';
  const markerClass =
    milestone.type === 'major'
      ? 'bg-black border-black/95'
      : 'bg-slate-500 border-[var(--color-surface)]/95';
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2"
      style={{ left: `calc(${left}% - 8px)` }}
    >
      <div
        className={`absolute left-1/2 -translate-x-1/2 ${labelPositionClass}`}
        style={{ marginLeft: `${labelOffset}px` }}
      >
        <div className="inline-flex flex-col items-start whitespace-nowrap leading-none">
          <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
            {milestone.name}
          </span>
          <span className="mt-0.5 text-[8.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-muted)]/80">
            {format(parseISO(milestone.date), 'MMM d')}
          </span>
        </div>
      </div>
      <button
        ref={setNodeRef}
        type="button"
        aria-label={`Move milestone ${milestone.name}`}
        className="relative cursor-grab touch-none active:cursor-grabbing"
        style={{
          transform: CSS.Translate.toString(transform),
          opacity: isDragging ? 0.35 : 1,
          zIndex: isDragging ? 40 : undefined,
        }}
        onDoubleClick={onEdit}
        {...attributes}
        {...listeners}
      >
        <div
          className={`h-3.5 w-3.5 rotate-45 rounded-[2px] border shadow-[0_6px_14px_rgba(15,23,42,0.18)] ${markerClass}`}
        />
      </button>
    </div>
  );
}

function MilestoneDropRow({
  id,
  goalId,
  projectId,
  className,
  style,
  children,
}: {
  id: string;
  goalId: number | null;
  projectId: number | null;
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: goalId == null,
    data: {
      type: 'milestone-target',
      goalId,
      projectId,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? 'bg-[var(--color-accent-subtle)]/45' : ''}`}
      style={style}
    >
      {children}
    </div>
  );
}

function MilestoneTypePills({
  value,
  onChange,
}: {
  value: MilestoneType;
  onChange: (value: MilestoneType) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {([
        { value: 'major' as const, label: 'Major' },
        { value: 'project' as const, label: 'Project' },
      ]).map((option) => {
        const active = value === option.value;
        const activeClass =
          option.value === 'major'
            ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white'
            : 'border-[#94a3b8]/25 bg-[#94a3b8]/14 text-[#64748b]';
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
              active
                ? activeClass
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/20 hover:text-[var(--color-text-primary)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PlannerToolbar({
  year,
  zoom,
  horizontalScale,
  onZoomChange,
  onHorizontalScaleChange,
  onOpenGoal,
  onOpenMilestone,
  onOpenProject,
}: {
  year: number;
  zoom: PlannerZoom;
  horizontalScale: number;
  onZoomChange: (zoom: PlannerZoom) => void;
  onHorizontalScaleChange: (scale: number) => void;
  onOpenGoal: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpenMilestone: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpenProject: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const { navigateYear, setCurrentDate } = usePlannerStore();

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenGoal}
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]/20 hover:text-[var(--color-text-primary)]"
        >
          <Flag size={13} />
          Goal
        </button>
        <button
          type="button"
          onClick={onOpenMilestone}
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]/20 hover:text-[var(--color-text-primary)]"
        >
          <MilestoneIcon size={13} />
          Milestone
        </button>
        <button
          type="button"
          onClick={onOpenProject}
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)]/20 hover:text-[var(--color-text-primary)]"
        >
          <FolderPlus size={13} />
          Project
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigateYear('prev')} className="ui-icon-button">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[1.15rem] font-bold tracking-tight text-[var(--color-text-primary)]">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setCurrentDate(format(new Date(), 'yyyy-MM-dd'))}
            className="rounded-full bg-[var(--color-accent-subtle)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-accent)]"
          >
            Today
          </button>
        </div>
        <button type="button" onClick={() => navigateYear('next')} className="ui-icon-button">
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
          {(['detail', 'week', 'month', 'quarter'] as const).map((option) => {
            const isActive = zoom === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onZoomChange(option)}
                className={[
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-all',
                  isActive
                    ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {option === 'detail' ? 'Detail' : option === 'week' ? 'Week' : option === 'month' ? 'Month' : 'Quarter'}
              </button>
            );
          })}
        </div>
        <label
          className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)]/70 bg-[var(--color-surface)]/70 px-2 py-1"
          title={`Horizontal zoom ${Math.round(horizontalScale * 100)}%`}
        >
          <span className="text-[10px] text-[var(--color-text-muted)]">−</span>
          <input
            type="range"
            min="65"
            max="200"
            step="5"
            value={Math.round(horizontalScale * 100)}
            onChange={(event) => onHorizontalScaleChange(Number(event.target.value) / 100)}
            className="h-1 w-16 cursor-ew-resize accent-[var(--color-accent)]"
            aria-label="Horizontal timeline zoom"
          />
          <span className="text-[10px] text-[var(--color-text-muted)]">+</span>
        </label>
      </div>
    </div>
  );
}

function PlannerProjectCreatePopover({
  anchor,
  onClose,
  onCreate,
  goals,
  defaultGoalId,
  defaultStartDate,
  defaultEndDate,
  year,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onCreate: (project: Project) => void;
  goals: Goal[];
  defaultGoalId: number | null;
  defaultStartDate?: string | null;
  defaultEndDate?: string | null;
  year: number;
}) {
  const [goalId, setGoalId] = useState<string>(defaultGoalId ? String(defaultGoalId) : '');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(defaultStartDate ?? `${year}-01-01`);
  const [endDate, setEndDate] = useState(defaultEndDate ?? `${year}-03-31`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    if (startDate && endDate && startDate > endDate) {
      setError('Please choose a valid start and end date.');
      return;
    }

    const ts = new Date().toISOString();
    const clientId = crypto.randomUUID();
    const project: Project = {
      id: clientId,
      title: title.trim(),
      goalId: goalId ? Number.parseInt(goalId, 10) : undefined,
      sortOrder: 0,
      subtaskIds: [],
      status: 'active',
      startDate,
      endDate,
      createdAt: ts,
      updatedAt: ts,
    };

    setSaving(true);
    setError(null);
    try {
      const { id } = await createProject(project);
      onCreate({ ...project, backendId: id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailPopover anchor={anchor} onClose={onClose} className="w-[23rem]" title="New Project">
      <div className="flex flex-col gap-3.5">
        <PopoverField label="Name">
          <PopoverInput value={title} onChange={setTitle} placeholder="Project name" />
        </PopoverField>
        <PopoverField label="Goal">
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)} className="ui-input">
            <option value="">Unassigned</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.backendId}>
                {goal.name}
              </option>
            ))}
          </select>
        </PopoverField>
        <div className="grid grid-cols-2 gap-3">
          <PopoverField label="Start">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
          <PopoverField label="End">
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
        </div>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/72 px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/15 bg-[var(--color-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:brightness-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create project
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}

function PlannerProjectEditPopover({
  anchor,
  project,
  goals,
  milestones,
  year,
  onClose,
  onSave,
  onDelete,
  onOpenMilestone,
}: {
  anchor: HTMLElement;
  project: Project;
  goals: Goal[];
  milestones: Milestone[];
  year: number;
  onClose: () => void;
  onSave: (project: Project) => void;
  onDelete: (project: Project) => void;
  onOpenMilestone: (milestone: Milestone, anchor: HTMLElement) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [goalId, setGoalId] = useState(project.goalId == null ? '' : String(project.goalId));
  const [startDate, setStartDate] = useState(project.startDate ?? `${year}-01-01`);
  const [endDate, setEndDate] = useState(project.endDate ?? `${year}-03-31`);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!project.backendId || saving) return;
    if (!title.trim()) {
      setError('Please enter a project name.');
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setError('Please choose a valid start and end date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextGoalId = goalId ? Number.parseInt(goalId, 10) : undefined;
      await patchProject(project.backendId, {
        title: title.trim(),
        goal_id: nextGoalId ?? null,
        start_date: startDate,
        end_date: endDate,
      });
      onSave({
        ...project,
        title: title.trim(),
        goalId: nextGoalId,
        startDate,
        endDate,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!project.backendId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(project.backendId);
      onDelete(project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project.');
      setDeleting(false);
    }
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={onClose}
      className="w-[25rem]"
      title="Edit Project"
      headerActions={(
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={saving || deleting}
          className="ui-icon-button ui-icon-button--danger disabled:opacity-40"
          aria-label="Delete project"
          title="Delete project"
        >
          <Trash2 size={12} strokeWidth={2.25} />
        </button>
      )}
    >
      <div className="flex flex-col gap-3.5">
        <PopoverField label="Name">
          <PopoverInput value={title} onChange={setTitle} placeholder="Project name" />
        </PopoverField>
        <PopoverField label="Goal">
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)} className="ui-input">
            <option value="">Unassigned</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.backendId}>
                {goal.name}
              </option>
            ))}
          </select>
        </PopoverField>
        <div className="grid grid-cols-2 gap-3">
          <PopoverField label="Start">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
          <PopoverField label="End">
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
        </div>
        <PopoverField label={`Milestones (${milestones.length})`}>
          <div className="max-h-36 space-y-1 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/55 p-1.5">
            {milestones.length ? milestones.map((milestone) => (
              <button
                key={milestone.id}
                type="button"
                onClick={(event) => onOpenMilestone(milestone, event.currentTarget)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-[var(--color-canvas)]"
              >
                <span className="min-w-0 truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                  {milestone.name}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                  {format(parseISO(milestone.date), 'MMM d')}
                </span>
              </button>
            )) : (
              <div className="px-2.5 py-3 text-[11px] text-[var(--color-text-muted)]">
                No milestones in this project yet.
              </div>
            )}
          </div>
        </PopoverField>
        {confirmDelete && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-950/20">
            <div className="text-[12px] font-semibold text-red-700 dark:text-red-300">
              Delete this project?
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-red-600/85 dark:text-red-300/75">
              Its milestones will be deleted. Tasks and recurrent tasks will become unassigned.
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]"
              >
                Keep project
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/72 px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || deleting || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/15 bg-[var(--color-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:brightness-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save changes
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}

function PlannerGoalCreatePopover({
  anchor,
  onClose,
  onCreate,
  year,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onCreate: (goal: Goal) => void;
  year: number;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(GOAL_COLORS[0]);
  const [startDate, setStartDate] = useState(`${year}-01-01`);
  const [endDate, setEndDate] = useState(`${year}-03-31`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const goal = await createGoal({
        name: name.trim(),
        color,
        startDate,
        endDate,
      });
      onCreate(goal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create goal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailPopover anchor={anchor} onClose={onClose} className="w-[23rem]" title="New Goal">
      <div className="flex flex-col gap-3.5">
        <PopoverField label="Name">
          <PopoverInput value={name} onChange={setName} placeholder="Goal name" />
        </PopoverField>
        <PopoverField label="Color">
          <div className="flex flex-wrap gap-2">
            {GOAL_COLORS.map((swatch) => {
              const active = swatch === color;
              return (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  className={`h-8 w-8 rounded-full border transition ${active ? 'scale-105 shadow-[0_0_0_3px_rgba(91,108,255,0.12)]' : ''}`}
                  style={{
                    backgroundColor: swatch,
                    borderColor: active ? swatch : 'rgba(148,163,184,0.24)',
                  }}
                  aria-label={`Select color ${swatch}`}
                />
              );
            })}
          </div>
        </PopoverField>
        <div className="grid grid-cols-2 gap-3">
          <PopoverField label="Start">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
          <PopoverField label="End">
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="ui-input"
            />
          </PopoverField>
        </div>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create goal
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}

function PlannerMilestoneCreatePopover({
  anchor,
  onClose,
  onCreate,
  goals,
  projects,
  defaultGoalId,
  defaultProjectId,
  year,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onCreate: (milestone: Milestone) => void;
  goals: Goal[];
  projects: Project[];
  defaultGoalId: number | null;
  defaultProjectId?: number | null;
  year: number;
}) {
  const [target, setTarget] = useState(
    defaultProjectId
      ? `project:${defaultProjectId}`
      : defaultGoalId
        ? `goal:${defaultGoalId}`
        : '',
  );
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<MilestoneType>('major');
  const [date, setDate] = useState(`${year}-06-15`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target && goals[0]?.backendId) {
      setTarget(`goal:${goals[0].backendId}`);
    }
  }, [target, goals]);

  const handleSubmit = async () => {
    const [targetKind, targetIdValue] = target.split(':');
    const targetId = Number.parseInt(targetIdValue, 10);
    const selectedProject = targetKind === 'project'
      ? projects.find((project) => project.backendId === targetId)
      : undefined;
    const numericGoalId = targetKind === 'goal' ? targetId : selectedProject?.goalId;
    if (!name.trim() || numericGoalId == null || Number.isNaN(numericGoalId) || saving) return;
    setSaving(true);
    setError(null);
    try {
      const milestone = await createMilestone({
        goalId: numericGoalId,
        projectId: selectedProject?.backendId,
        name: name.trim(),
        notes: notes.trim() || undefined,
        type,
        date,
      });
      onCreate(milestone);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create milestone.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailPopover anchor={anchor} onClose={onClose} className="w-[23rem]" title="New Milestone">
      <div className="flex flex-col gap-3.5">
        {goals.length ? (
          <>
            <PopoverField label="Place on">
              <select value={target} onChange={(event) => setTarget(event.target.value)} className="ui-input">
                <optgroup label="Goals">
                {goals.map((goal) => (
                  <option key={goal.id} value={`goal:${goal.backendId}`}>
                    {goal.name}
                  </option>
                ))}
                </optgroup>
                {goals.map((goal) => {
                  const goalProjects = projects.filter(
                    (project) => project.goalId === goal.backendId && project.backendId != null,
                  );
                  if (!goalProjects.length) return null;
                  return (
                    <optgroup key={`projects-${goal.id}`} label={`${goal.name} projects`}>
                      {goalProjects.map((project) => (
                        <option key={project.id} value={`project:${project.backendId}`}>
                          {project.title}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </PopoverField>
            <PopoverField label="Name">
              <PopoverInput value={name} onChange={setName} placeholder="Milestone name" />
            </PopoverField>
            <PopoverField label="Notes">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Context, definition of done, or useful details…"
                rows={3}
                className="ui-input resize-y"
              />
            </PopoverField>
            <PopoverField label="Type">
              <MilestoneTypePills value={type} onChange={setType} />
            </PopoverField>
            <PopoverField label="Date">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="ui-input"
              />
            </PopoverField>
          </>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            Create a goal first, then add milestones to it.
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !goals.length || !name.trim() || !target}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create milestone
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}

function PlannerMilestoneEditPopover({
  anchor,
  milestone,
  goals,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  anchor: HTMLElement;
  milestone: Milestone;
  goals: Goal[];
  projects: Project[];
  onClose: () => void;
  onSave: (nextMilestone: Milestone) => void;
  onDelete: (milestoneId: string) => void;
}) {
  const [target, setTarget] = useState(
    milestone.projectId ? `project:${milestone.projectId}` : `goal:${milestone.goalId}`,
  );
  const [name, setName] = useState(milestone.name);
  const [notes, setNotes] = useState(milestone.notes ?? '');
  const [type, setType] = useState<MilestoneType>(milestone.type);
  const [date, setDate] = useState(milestone.date);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!milestone.backendId || saving) return;
    const [targetKind, targetIdValue] = target.split(':');
    const targetId = Number.parseInt(targetIdValue, 10);
    const selectedProject = targetKind === 'project'
      ? projects.find((project) => project.backendId === targetId)
      : undefined;
    const numericGoalId = targetKind === 'goal' ? targetId : selectedProject?.goalId;
    if (!name.trim() || numericGoalId == null || Number.isNaN(numericGoalId)) return;
    setSaving(true);
    setError(null);
    try {
      await patchMilestone(milestone.backendId, {
        goal_id: numericGoalId,
        project_id: selectedProject?.backendId ?? null,
        name: name.trim(),
        notes: notes.trim() || null,
        type,
        date,
      });
      onSave({
        ...milestone,
        goalId: numericGoalId,
        projectId: selectedProject?.backendId,
        name: name.trim(),
        notes: notes.trim() || undefined,
        type,
        date,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update milestone.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!milestone.backendId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMilestone(milestone.backendId);
      onDelete(milestone.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete milestone.');
      setDeleting(false);
    }
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={onClose}
      className="w-[23rem]"
      title="Edit Milestone"
      headerActions={(
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting || saving}
          className="ui-icon-button ui-icon-button--danger disabled:opacity-40"
          aria-label="Delete milestone"
          title="Delete milestone"
        >
          <Trash2 size={12} strokeWidth={2.25} />
        </button>
      )}
    >
      <div className="flex flex-col gap-3.5">
        <PopoverField label="Place on">
          <select value={target} onChange={(event) => setTarget(event.target.value)} className="ui-input">
            <optgroup label="Goals">
            {goals.map((goal) => (
              <option key={goal.id} value={`goal:${goal.backendId}`}>
                {goal.name}
              </option>
            ))}
            </optgroup>
            {goals.map((goal) => {
              const goalProjects = projects.filter(
                (project) => project.goalId === goal.backendId && project.backendId != null,
              );
              if (!goalProjects.length) return null;
              return (
                <optgroup key={`projects-${goal.id}`} label={`${goal.name} projects`}>
                  {goalProjects.map((project) => (
                    <option key={project.id} value={`project:${project.backendId}`}>
                      {project.title}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </PopoverField>
        <PopoverField label="Name">
          <PopoverInput value={name} onChange={setName} placeholder="Milestone name" />
        </PopoverField>
        <PopoverField label="Notes">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Context, definition of done, or useful details…"
            rows={4}
            className="ui-input resize-y"
          />
        </PopoverField>
        <PopoverField label="Type">
          <MilestoneTypePills value={type} onChange={setType} />
        </PopoverField>
        <PopoverField label="Date">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="ui-input"
          />
        </PopoverField>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || deleting || !name.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save changes
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}

function GoalDeleteDialog({
  goal,
  projectCount,
  deleting,
  onCancel,
  onConfirm,
}: {
  goal: Goal;
  projectCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-goal-title"
        className="w-full max-w-sm rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-canvas)] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
      >
        <h2 id="delete-goal-title" className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          Delete “{goal.name}”?
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
          This permanently deletes the Goal, its {projectCount} {projectCount === 1 ? 'project' : 'projects'}, and all milestones. Tasks inside those projects will become unassigned.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete Goal'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlannerView() {
  const currentDate = usePlannerStore((state) => state.currentDate);
  const fallbackProjects = usePlannerStore((state) => state.projects);
  const year = parseISO(currentDate).getFullYear();
  const [zoom, setZoom] = useState<PlannerZoom>('month');
  const [horizontalScale, setHorizontalScale] = useState(1);
  const [collapsedGoalIds, setCollapsedGoalIds] = useState<Set<number>>(new Set());
  const [collapsedGoalsLoaded, setCollapsedGoalsLoaded] = useState(false);
  const [planner, setPlanner] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<PlannerInteraction | null>(null);
  const [goalPopoverOpen, setGoalPopoverOpen] = useState(false);
  const [milestonePopoverOpen, setMilestonePopoverOpen] = useState(false);
  const [milestoneEditPopover, setMilestoneEditPopover] = useState<{
    anchor: HTMLElement;
    milestoneId: string;
  } | null>(null);
  const [projectPopover, setProjectPopover] = useState<{
    anchor: HTMLElement;
    goalId: number | null;
    startDate?: string | null;
    endDate?: string | null;
  } | null>(null);
  const [goalAnchor, setGoalAnchor] = useState<HTMLElement | null>(null);
  const [milestoneAnchor, setMilestoneAnchor] = useState<HTMLElement | null>(null);
  const [projectRangePopover, setProjectRangePopover] = useState<{
    anchor: HTMLElement;
    projectId: string;
  } | null>(null);
  const [activeDraggedProjectId, setActiveDraggedProjectId] = useState<string | null>(null);
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [deletingGoal, setDeletingGoal] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const timelineCanvasRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    fetchPlanner()
      .then((data) => {
        if (!active) return;
        setPlanner(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load planner.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('planner-collapsed-goals');
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        setCollapsedGoalIds(new Set(parsed.filter((value): value is number => typeof value === 'number')));
      }
    } catch {
      // Ignore malformed local UI preferences.
    } finally {
      setCollapsedGoalsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!collapsedGoalsLoaded) return;
    window.localStorage.setItem('planner-collapsed-goals', JSON.stringify([...collapsedGoalIds]));
  }, [collapsedGoalIds, collapsedGoalsLoaded]);

  const plannerData = useMemo<PlannerData>(
    () => planner ?? { goals: [], projects: fallbackProjects },
    [planner, fallbackProjects],
  );
  const canPersist = planner !== null;
  const selectedGoalBackendId = plannerData.goals[0]?.backendId ?? null;

  const rows = useMemo(
    () => buildRows(plannerData.goals, plannerData.projects, collapsedGoalIds),
    [plannerData, collapsedGoalIds],
  );
  const projectItemIds = useMemo(
    () => rows.filter((row): row is Extract<PlannerRow, { kind: 'project' }> => row.kind === 'project').map((row) => row.id),
    [rows],
  );
  const segments = useMemo(() => buildPlannerSegments(year, zoom), [year, zoom]);
  const contentWidth = Math.round(TIMELINE_MIN_WIDTH[zoom] * horizontalScale);
  const totalRowHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const today = new Date();
  const todayPercent = isSameYear(today, new Date(year, 0, 1))
    ? dateToPercent(today, year) * 100
    : null;

  useEffect(() => {
    if (zoom !== 'detail' || todayPercent == null || !scrollContainerRef.current) return;
    const node = scrollContainerRef.current;
    const viewportWidth = node.clientWidth;
    const targetLeft = (contentWidth * todayPercent) / 100 - viewportWidth * 0.18;
    node.scrollTo({ left: Math.max(0, targetLeft), behavior: 'auto' });
  }, [contentWidth, todayPercent, year, zoom]);

  const startRangeInteraction = useCallback((
    kind: 'goal' | 'project',
    mode: 'move' | 'resize-start' | 'resize-end',
    backendId: number | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!canPersist || !backendId || !startDate || !endDate || !timelineCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = timelineCanvasRef.current.getBoundingClientRect();
    setInteraction({
      kind,
      mode,
      backendId,
      originX: event.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      initialStart: startDate,
      initialEnd: endDate,
      snapshot: plannerData,
    });
  }, [canPersist, plannerData]);

  useEffect(() => {
    if (!interaction) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const currentDateValue = xToDate(event.clientX - interaction.rectLeft, interaction.rectWidth, year, zoom);
      const originDateValue = xToDate(interaction.originX - interaction.rectLeft, interaction.rectWidth, year, zoom);
      const deltaDays = differenceInCalendarDays(currentDateValue, originDateValue);

      if (interaction.mode === 'move') {
        const nextRange = shiftRangeWithinYear(
          interaction.initialStart,
          interaction.initialEnd,
          deltaDays,
          year,
        );
        setPlanner((prev) => {
          if (!prev) return prev;
          if (interaction.kind === 'goal') {
            return {
              ...prev,
              goals: prev.goals.map((goal) =>
                goal.backendId === interaction.backendId
                  ? { ...goal, startDate: nextRange.startDate, endDate: nextRange.endDate }
                  : goal,
              ),
            };
          }
          return {
            ...prev,
            projects: prev.projects.map((project) =>
              project.backendId === interaction.backendId
                ? { ...project, startDate: nextRange.startDate, endDate: nextRange.endDate }
                : project,
            ),
          };
        });
        return;
      }

      if (interaction.mode === 'resize-start') {
        const current = clampDateToYear(currentDateValue, year);
        const currentEnd = parseISO(interaction.initialEnd);
        const nextStart = current > currentEnd ? currentEnd : current;
        const nextStartValue = format(nextStart, 'yyyy-MM-dd');
        setPlanner((prev) => {
          if (!prev) return prev;
          if (interaction.kind === 'goal') {
            return {
              ...prev,
              goals: prev.goals.map((goal) =>
                goal.backendId === interaction.backendId ? { ...goal, startDate: nextStartValue } : goal,
              ),
            };
          }
          return {
            ...prev,
            projects: prev.projects.map((project) =>
              project.backendId === interaction.backendId ? { ...project, startDate: nextStartValue } : project,
            ),
          };
        });
        return;
      }

      const current = clampDateToYear(currentDateValue, year);
      const currentStart = parseISO(interaction.initialStart);
      const nextEnd = current < currentStart ? currentStart : current;
      const nextEndValue = format(nextEnd, 'yyyy-MM-dd');
      setPlanner((prev) => {
        if (!prev) return prev;
        if (interaction.kind === 'goal') {
          return {
            ...prev,
            goals: prev.goals.map((goal) =>
              goal.backendId === interaction.backendId ? { ...goal, endDate: nextEndValue } : goal,
            ),
          };
        }
        return {
          ...prev,
          projects: prev.projects.map((project) =>
            project.backendId === interaction.backendId ? { ...project, endDate: nextEndValue } : project,
          ),
        };
      });
    };

    const handlePointerUp = () => {
      const snapshot = interaction.snapshot;
      const currentPlanner = planner;
      setInteraction(null);
      if (!currentPlanner) return;

      (async () => {
        try {
          if (interaction.kind === 'goal') {
            const nextGoal = currentPlanner.goals.find((goal) => goal.backendId === interaction.backendId);
            const previousGoal = snapshot.goals.find((goal) => goal.backendId === interaction.backendId);
            if (!nextGoal || !previousGoal) return;
            if (nextGoal.startDate === previousGoal.startDate && nextGoal.endDate === previousGoal.endDate) return;
            await patchGoal(interaction.backendId, {
              start_date: nextGoal.startDate,
              end_date: nextGoal.endDate,
            });
            return;
          }

          if (interaction.kind === 'project') {
            const nextProject = currentPlanner.projects.find((project) => project.backendId === interaction.backendId);
            const previousProject = snapshot.projects.find((project) => project.backendId === interaction.backendId);
            if (!nextProject || !previousProject) return;
            if (nextProject.startDate === previousProject.startDate && nextProject.endDate === previousProject.endDate) return;
            await patchProject(interaction.backendId, {
              start_date: nextProject.startDate ?? null,
              end_date: nextProject.endDate ?? null,
            });
            return;
          }

        } catch (err: unknown) {
          setPlanner(snapshot);
          setError(err instanceof Error ? err.message : 'Failed to update planner item.');
        }
      })();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [interaction, planner, year, zoom]);

  const handlePlannerDragEnd = useCallback(async ({ active, over, delta }: DragEndEvent) => {
    setActiveDraggedProjectId(null);
    const activeData = active.data.current;
    const overData = over?.data.current;
    if (!canPersist || !planner || !activeData) return;

    if (activeData.type === 'planner-milestone') {
      const milestone = planner.goals
        .flatMap((goal) => goal.milestones)
        .find((item) => item.id === activeData.milestoneId);
      if (!milestone?.backendId || !timelineCanvasRef.current) return;

      const targetData = overData?.type === 'milestone-target' ? overData : null;
      const targetGoalId = targetData?.goalId ?? milestone.goalId;
      const targetProjectId = targetData
        ? (targetData.projectId as number | null)
        : milestone.projectId ?? null;
      if (targetGoalId !== milestone.goalId) {
        setError('Milestones can only move within their current Goal.');
        return;
      }

      const canvasWidth = Math.max(1, timelineCanvasRef.current.getBoundingClientRect().width);
      const { start: yearStart, end: yearEnd } = getPlannerYearBounds(year);
      const yearDays = Math.max(1, differenceInCalendarDays(yearEnd, yearStart));
      const deltaDays = Math.round((delta.x / canvasWidth) * yearDays);
      const nextDate = format(
        clampDateToYear(addDays(parseISO(milestone.date), deltaDays), year),
        'yyyy-MM-dd',
      );
      const nextMilestone: Milestone = {
        ...milestone,
        projectId: targetProjectId ?? undefined,
        date: nextDate,
        updatedAt: new Date().toISOString(),
      };
      const snapshot = planner;
      setPlanner({
        ...planner,
        goals: planner.goals.map((goal) => ({
          ...goal,
          milestones: goal.milestones.map((item) =>
            item.id === milestone.id ? nextMilestone : item,
          ),
        })),
      });
      try {
        await patchMilestone(milestone.backendId, {
          project_id: targetProjectId,
          date: nextDate,
        });
      } catch (err: unknown) {
        setPlanner(snapshot);
        setError(err instanceof Error ? err.message : 'Failed to move milestone.');
      }
      return;
    }

    if (!over || active.id === over.id) return;
    if (activeData?.type !== 'planner-project') return;

    let targetGoalId: number | null = null;
    let overProjectId: string | null = null;

    if (overData?.type === 'planner-project') {
      targetGoalId = overData.goalId ?? null;
      overProjectId = overData.projectId as string;
    } else if (overData?.type === 'planner-bucket') {
      targetGoalId = overData.goalId ?? null;
    } else if (typeof over.id === 'string' && over.id.startsWith('project-')) {
      const overProject = planner.projects.find((project) => `project-${project.id}` === over.id);
      targetGoalId = overProject?.goalId ?? null;
      overProjectId = overProject?.id ?? null;
    } else {
      return;
    }

    const nextProjects = reorderProjects(
      planner.projects,
      activeData.projectId as string,
      targetGoalId,
      overProjectId,
    );
    const changedProjects = collectChangedProjects(planner.projects, nextProjects);
    if (!changedProjects.length) return;

    const snapshot = planner;
    const activeProject = planner.projects.find((project) => project.id === activeData.projectId);
    setPlanner({
      goals: activeProject?.backendId
        ? rehomeProjectMilestones(planner.goals, activeProject.backendId, targetGoalId)
        : planner.goals,
      projects: nextProjects,
    });

    try {
      await Promise.all(
        changedProjects.map((project) =>
          patchProject(project.backendId!, {
            goal_id: project.goalId ?? null,
            sort_order: project.sortOrder ?? 0,
          }),
        ),
      );
    } catch (err: unknown) {
      setPlanner(snapshot);
      setError(err instanceof Error ? err.message : 'Failed to reorder projects.');
    }
  }, [canPersist, planner, year]);

  const handlePlannerDragStart = useCallback(({ active }: DragStartEvent) => {
    const activeData = active.data.current;
    if (activeData?.type === 'planner-project') {
      setActiveDraggedProjectId(activeData.projectId as string);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-canvas)]">
      <PlannerToolbar
        year={year}
        zoom={zoom}
        horizontalScale={horizontalScale}
        onZoomChange={setZoom}
        onHorizontalScaleChange={setHorizontalScale}
        onOpenProject={(event) => {
          setProjectPopover({
            anchor: event.currentTarget,
            goalId: null,
            startDate: `${year}-01-01`,
            endDate: `${year}-03-31`,
          });
        }}
        onOpenGoal={(event) => {
          setGoalAnchor(event.currentTarget);
          setGoalPopoverOpen(true);
        }}
        onOpenMilestone={(event) => {
          setMilestoneAnchor(event.currentTarget);
          setMilestonePopoverOpen(true);
        }}
      />

      {goalToDelete && (
        <GoalDeleteDialog
          goal={goalToDelete}
          projectCount={plannerData.projects.filter((project) => project.goalId === goalToDelete.backendId).length}
          deleting={deletingGoal}
          onCancel={() => {
            if (!deletingGoal) setGoalToDelete(null);
          }}
          onConfirm={() => {
            if (!goalToDelete.backendId || deletingGoal) return;
            const goalBackendId = goalToDelete.backendId;
            setDeletingGoal(true);
            void deleteGoal(goalBackendId)
              .then(() => {
                setPlanner((prev) => prev
                  ? {
                      goals: prev.goals.filter((goal) => goal.backendId !== goalBackendId),
                      projects: prev.projects.filter((project) => project.goalId !== goalBackendId),
                    }
                  : prev);
                setCollapsedGoalIds((current) => {
                  const next = new Set(current);
                  next.delete(goalBackendId);
                  return next;
                });
                setGoalToDelete(null);
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to delete goal.');
              })
              .finally(() => setDeletingGoal(false));
          }}
        />
      )}

      {goalPopoverOpen && goalAnchor && (
        <PlannerGoalCreatePopover
          anchor={goalAnchor}
          year={year}
          onClose={() => {
            setGoalPopoverOpen(false);
            setGoalAnchor(null);
          }}
          onCreate={(goal) => {
            setPlanner((prev) => ({
              goals: [...(prev?.goals ?? []), goal].sort((a, b) => a.startDate.localeCompare(b.startDate)),
              projects: prev?.projects ?? fallbackProjects,
            }));
          }}
        />
      )}

      {projectPopover && (
        <PlannerProjectCreatePopover
          anchor={projectPopover.anchor}
          goals={plannerData.goals}
          defaultGoalId={projectPopover.goalId}
          defaultStartDate={projectPopover.startDate}
          defaultEndDate={projectPopover.endDate}
          year={year}
          onClose={() => setProjectPopover(null)}
          onCreate={(project) => {
            setPlanner((prev) => {
              const nextProjects = [...(prev?.projects ?? fallbackProjects), project];
              return {
                goals: prev?.goals ?? [],
                projects: nextProjects,
              };
            });
          }}
        />
      )}

      {milestonePopoverOpen && milestoneAnchor && (
        <PlannerMilestoneCreatePopover
          anchor={milestoneAnchor}
          year={year}
          goals={plannerData.goals}
          projects={plannerData.projects}
          defaultGoalId={selectedGoalBackendId}
          defaultProjectId={null}
          onClose={() => {
            setMilestonePopoverOpen(false);
            setMilestoneAnchor(null);
          }}
          onCreate={(milestone) => {
            setPlanner((prev) => {
              const baseGoals = prev?.goals ?? [];
              return {
                goals: baseGoals.map((goal) =>
                  goal.backendId === milestone.goalId
                    ? {
                        ...goal,
                        milestones: [...goal.milestones, milestone].sort((a, b) => a.date.localeCompare(b.date)),
                      }
                    : goal,
                ),
                projects: prev?.projects ?? fallbackProjects,
              };
            });
          }}
        />
      )}

      {milestoneEditPopover && (() => {
        const milestone = plannerData.goals
          .flatMap((goal) => goal.milestones)
          .find((item) => item.id === milestoneEditPopover.milestoneId);
        if (!milestone) return null;
        return (
          <PlannerMilestoneEditPopover
            anchor={milestoneEditPopover.anchor}
            milestone={milestone}
            goals={plannerData.goals}
            projects={plannerData.projects}
            onClose={() => setMilestoneEditPopover(null)}
            onSave={(nextMilestone) => {
              setPlanner((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  goals: prev.goals.map((goal) => {
                    const remainingMilestones = goal.milestones.filter((item) => item.id !== nextMilestone.id);
                    if (goal.backendId === nextMilestone.goalId) {
                      return {
                        ...goal,
                        milestones: [...remainingMilestones, nextMilestone].sort((a, b) => a.date.localeCompare(b.date)),
                      };
                    }
                    return {
                      ...goal,
                      milestones: remainingMilestones,
                    };
                  }),
                };
              });
            }}
            onDelete={(milestoneId) => {
              setPlanner((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  goals: prev.goals.map((goal) => ({
                    ...goal,
                    milestones: goal.milestones.filter((item) => item.id !== milestoneId),
                  })),
                };
              });
            }}
          />
        );
      })()}

      {projectRangePopover && (() => {
        const project = plannerData.projects.find((item) => item.id === projectRangePopover.projectId);
        if (!project) return null;
        const projectMilestones = plannerData.goals
          .flatMap((goal) => goal.milestones)
          .filter((milestone) => milestone.projectId === project.backendId);
        return (
          <PlannerProjectEditPopover
            anchor={projectRangePopover.anchor}
            project={project}
            goals={plannerData.goals}
            milestones={projectMilestones}
            year={year}
            onClose={() => setProjectRangePopover(null)}
            onOpenMilestone={(milestone, anchor) => {
              setMilestoneEditPopover({ anchor, milestoneId: milestone.id });
            }}
            onSave={(nextProject) => {
              setPlanner((prev) => {
                if (!prev) return prev;
                const movedToGoal = (nextProject.goalId ?? null) !== (project.goalId ?? null);
                return {
                  goals: movedToGoal && project.backendId
                    ? rehomeProjectMilestones(prev.goals, project.backendId, nextProject.goalId ?? null)
                    : prev.goals,
                  projects: prev.projects.map((item) =>
                    item.id === nextProject.id
                      ? nextProject
                      : item,
                  ),
                };
              });
            }}
            onDelete={(deletedProject) => {
              setPlanner((prev) => {
                if (!prev) return prev;
                return {
                  goals: prev.goals.map((goal) => ({
                    ...goal,
                    milestones: goal.milestones.filter(
                      (milestone) => milestone.projectId !== deletedProject.backendId,
                    ),
                  })),
                  projects: prev.projects.filter((item) => item.id !== deletedProject.id),
                };
              });
            }}
          />
        );
      })()}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
          Loading planner…
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto">
          {error && (
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/75 px-6 py-2 text-[12px] text-[var(--color-text-muted)]">
              {planner ? error : 'Planner backend unavailable right now. Showing local project preview.'}
            </div>
          )}
          {!rows.length ? (
            <div className="flex min-h-full items-center justify-center px-6">
              <div className="max-w-md rounded-[1.5rem] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5 text-center text-sm text-[var(--color-text-muted)]">
                Add your first goal or assign project dates to start mapping longer-term work here.
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handlePlannerDragStart}
              onDragEnd={handlePlannerDragEnd}
              onDragCancel={() => setActiveDraggedProjectId(null)}
            >
              <div
                className="grid min-h-full"
                style={{
                  gridTemplateColumns: `${LABEL_WIDTH}px minmax(${contentWidth}px, 1fr)`,
                  minWidth: LABEL_WIDTH + contentWidth,
                }}
              >
                <SortableContext items={projectItemIds} strategy={verticalListSortingStrategy}>
                  <div className="sticky left-0 z-20 border-r border-[var(--color-border)] bg-[var(--color-canvas)]">
                    <div className="sticky top-0 z-10 h-12 border-b border-[var(--color-border)] bg-[var(--color-canvas)]" />
                    {rows.map((row) => {
                      if (row.kind === 'goal') {
                        const goalBackendId = row.goal.backendId;
                        const collapsed = goalBackendId != null && collapsedGoalIds.has(goalBackendId);
                        return (
                          <GoalLabelRow
                            key={row.id}
                            row={row}
                            collapsed={collapsed}
                            onToggleCollapsed={() => {
                              if (goalBackendId == null) return;
                              setCollapsedGoalIds((current) => {
                                const next = new Set(current);
                                if (next.has(goalBackendId)) next.delete(goalBackendId);
                                else next.add(goalBackendId);
                                return next;
                              });
                            }}
                            onDelete={() => setGoalToDelete(row.goal)}
                          />
                        );
                      }

                      if (row.kind === 'project') {
                        return (
                          <SortableProjectLabelRow
                            key={row.id}
                            row={row}
                            isGhosted={activeDraggedProjectId === row.project.id}
                            onOpen={(anchor) =>
                              setProjectRangePopover({
                                anchor,
                                projectId: row.project.id,
                              })
                            }
                          />
                        );
                      }

                      if (row.kind === 'add-project') {
                        return (
                          <PlannerBucketDropRow
                            key={row.id}
                            id={`bucket-goal-${row.goal.backendId ?? row.goal.id}`}
                            goalId={row.goal.backendId ?? null}
                            height={row.height}
                            className="flex items-center px-4"
                          >
                            <button
                              type="button"
                              onClick={(event) =>
                                setProjectPopover({
                                  anchor: event.currentTarget,
                                  goalId: row.goal.backendId ?? null,
                                  startDate: row.goal.startDate,
                                  endDate: row.goal.endDate,
                                })
                              }
                              className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] font-medium text-[var(--color-text-muted)] transition hover:text-[var(--color-text-secondary)]"
                            >
                              <Plus size={12} />
                              Add project
                            </button>
                          </PlannerBucketDropRow>
                        );
                      }

                      if (row.kind === 'unassigned-label') {
                        return (
                          <PlannerBucketDropRow
                            key={row.id}
                            id="bucket-unassigned"
                            goalId={null}
                            height={row.height}
                            className="flex items-center border-y border-[var(--color-border)] bg-[var(--color-surface)]/45 px-4"
                          >
                            <div className="text-[12px] font-semibold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                              Unassigned
                            </div>
                          </PlannerBucketDropRow>
                        );
                      }

                      return (
                        <div
                          key={row.id}
                          className="border-y border-[var(--color-border)]/35 bg-[var(--color-surface)]/35"
                          style={{ height: row.height }}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

                <div className="relative min-w-0">
                  <div
                    className="sticky top-0 z-10 grid h-12 border-b border-[var(--color-border)] bg-[var(--color-canvas)]"
                    style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
                  >
                    {segments.map((segment, index) => (
                      <div
                        key={segment.key}
                        className={[
                          'flex items-center border-r border-[var(--color-border)]/55 px-3 text-[11px] font-semibold tracking-[0.14em] uppercase text-[var(--color-text-muted)]',
                          zoom === 'week' && index > 0 && segment.label === segments[index - 1]?.label ? 'text-transparent' : '',
                        ].join(' ')}
                      >
                        {segment.label}
                      </div>
                    ))}
                  </div>

                  <div ref={timelineCanvasRef} className="relative" style={{ minHeight: totalRowHeight }}>
                    <div
                      className="pointer-events-none absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
                    >
                      {segments.map((segment) => (
                        <div key={segment.key} className="border-r border-[var(--color-border)]/55" />
                      ))}
                    </div>

                    {todayPercent !== null && (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 z-[1] w-px bg-red-500/85"
                        style={{ left: `${todayPercent}%` }}
                      />
                    )}

                    <div className="relative z-[2]">
                      {rows.map((row) => {
                      if (row.kind === 'goal') {
                        const range = rangeToPercent(row.goal.startDate, row.goal.endDate, year);
                        const goalMilestones = row.goal.milestones.filter((milestone) => milestone.projectId == null);
                        const milestoneLayoutMap = getMilestoneLabelLayoutMap(goalMilestones);
                        return (
                          <MilestoneDropRow
                            key={row.id}
                            id={`milestone-target-goal-${row.goal.backendId}`}
                            goalId={row.goal.backendId!}
                            projectId={null}
                            className="relative border-y border-[var(--color-border)]/70 bg-[var(--color-surface)]/18"
                            style={{ height: row.height }}
                          >
                              <TimelineBar
                                left={range.left}
                                width={range.width}
                                thickness={10}
                                color={row.goal.color}
                                onMoveStart={(event) =>
                                  startRangeInteraction(
                                    'goal',
                                    'move',
                                    row.goal.backendId,
                                    row.goal.startDate,
                                    row.goal.endDate,
                                    event,
                                  )
                                }
                                onResizeStart={(event) =>
                                  startRangeInteraction(
                                    'goal',
                                    'resize-start',
                                    row.goal.backendId,
                                    row.goal.startDate,
                                    row.goal.endDate,
                                    event,
                                  )
                                }
                                onResizeEnd={(event) =>
                                  startRangeInteraction(
                                    'goal',
                                    'resize-end',
                                    row.goal.backendId,
                                    row.goal.startDate,
                                    row.goal.endDate,
                                    event,
                                  )
                                }
                              />
                              {goalMilestones.map((milestone) => (
                                <MilestoneMarker
                                  key={milestone.id}
                                  milestone={milestone}
                                  year={year}
                                  lane={milestoneLayoutMap.get(milestone.id)?.lane ?? 0}
                                  labelOffset={milestoneLayoutMap.get(milestone.id)?.offset ?? 0}
                                  onEdit={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setMilestoneEditPopover({
                                      anchor: event.currentTarget,
                                      milestoneId: milestone.id,
                                    });
                                  }}
                                />
                              ))}
                          </MilestoneDropRow>
                          );
                        }

                        if (row.kind === 'project') {
                          const outside = isProjectOutsideGoal(row.project, row.goal);
                          const color = outside ? '#f59e0b' : row.goal?.color ?? '#94a3b8';
                          const projectMilestones = row.goal?.milestones.filter(
                            (milestone) => milestone.projectId === row.project.backendId,
                          ) ?? [];
                          const milestoneLayoutMap = getMilestoneLabelLayoutMap(projectMilestones);
                          return (
                            <MilestoneDropRow
                              key={row.id}
                              id={`milestone-target-project-${row.project.backendId}`}
                              goalId={row.goal?.backendId ?? null}
                              projectId={row.project.backendId ?? null}
                              className="relative border-b border-[var(--color-border)]/40"
                              style={{
                                height: row.height,
                                opacity: activeDraggedProjectId === row.project.id ? 0.2 : 1,
                              }}
                            >
                              {row.project.startDate && row.project.endDate ? (
                                <TimelineBar
                                  left={rangeToPercent(row.project.startDate, row.project.endDate, year).left}
                                  width={rangeToPercent(row.project.startDate, row.project.endDate, year).width}
                                  thickness={6}
                                  color={color}
                                  onMoveStart={(event) =>
                                    startRangeInteraction(
                                      'project',
                                      'move',
                                      row.project.backendId,
                                      row.project.startDate,
                                      row.project.endDate,
                                      event,
                                    )
                                  }
                                  onResizeStart={(event) =>
                                    startRangeInteraction(
                                      'project',
                                      'resize-start',
                                      row.project.backendId,
                                      row.project.startDate,
                                      row.project.endDate,
                                      event,
                                    )
                                  }
                                  onResizeEnd={(event) =>
                                    startRangeInteraction(
                                      'project',
                                      'resize-end',
                                      row.project.backendId,
                                      row.project.startDate,
                                      row.project.endDate,
                                      event,
                                    )
                                  }
                                />
                              ) : (
                                <TimelinePlaceholder
                                  label="No range"
                                  onClick={(event) => {
                                    setProjectRangePopover({
                                      anchor: event.currentTarget,
                                      projectId: row.project.id,
                                    });
                                  }}
                                />
                              )}
                              {projectMilestones.map((milestone) => (
                                <MilestoneMarker
                                  key={milestone.id}
                                  milestone={milestone}
                                  year={year}
                                  lane={milestoneLayoutMap.get(milestone.id)?.lane ?? 0}
                                  labelOffset={milestoneLayoutMap.get(milestone.id)?.offset ?? 0}
                                  onEdit={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setMilestoneEditPopover({
                                      anchor: event.currentTarget,
                                      milestoneId: milestone.id,
                                    });
                                  }}
                                />
                              ))}
                            </MilestoneDropRow>
                          );
                        }

                        if (row.kind === 'add-project') {
                          return (
                            <div
                              key={row.id}
                              className="relative"
                              style={{ height: row.height }}
                            />
                          );
                        }

                        if (row.kind === 'unassigned-label') {
                          return (
                            <div
                              key={row.id}
                              className="border-y border-[var(--color-border)] bg-[var(--color-surface)]/45"
                              style={{ height: row.height }}
                            />
                          );
                        }

                        return (
                          <div
                            key={row.id}
                            className="border-y border-[var(--color-border)]/35 bg-[var(--color-surface)]/35"
                            style={{ height: row.height }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDraggedProjectId ? (() => {
                  const activeRow = rows.find(
                    (row): row is Extract<PlannerRow, { kind: 'project' }> =>
                      row.kind === 'project' && row.project.id === activeDraggedProjectId,
                  );
                  return activeRow ? <PlannerProjectDragOverlay row={activeRow} /> : null;
                })() : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}
