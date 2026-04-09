'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
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
  deleteMilestone,
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
    }
  | {
      kind: 'milestone';
      mode: 'move';
      backendId: number;
      originX: number;
      rectLeft: number;
      rectWidth: number;
      initialDate: string;
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

function buildRows(goals: Goal[], projects: Project[]): PlannerRow[] {
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
    const goalProjects = [...(byGoalId.get(goal.backendId ?? -1) ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    for (const project of goalProjects) {
      rows.push({ id: `project-${project.id}`, kind: 'project', goal, project, height: 42 });
    }
    rows.push({ id: `goal-add-${goal.id}`, kind: 'add-project', goal, height: 42 });
    rows.push({ id: `goal-gap-${goal.id}`, kind: 'group-gap', height: 0 });
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
}: {
  row: Extract<PlannerRow, { kind: 'project' }>;
  isGhosted?: boolean;
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
}: {
  row: Extract<PlannerRow, { kind: 'goal' }>;
}) {
  return (
    <div
      className="flex items-center gap-3 border-b border-[var(--color-border)]/55 px-4"
      style={{ height: row.height }}
    >
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
  onMoveStart,
  onEdit,
}: {
  milestone: Milestone;
  year: number;
  lane?: number;
  labelOffset?: number;
  onMoveStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onEdit?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
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
        type="button"
        aria-label={`Move milestone ${milestone.name}`}
        className="relative cursor-ew-resize"
        onPointerDown={onMoveStart}
        onDoubleClick={onEdit}
      >
        <div
          className={`h-3.5 w-3.5 rotate-45 rounded-[2px] border shadow-[0_6px_14px_rgba(15,23,42,0.18)] ${markerClass}`}
        />
      </button>
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
  onZoomChange,
  onOpenGoal,
  onOpenMilestone,
  onOpenProject,
}: {
  year: number;
  zoom: PlannerZoom;
  onZoomChange: (zoom: PlannerZoom) => void;
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

function PlannerProjectRangePopover({
  anchor,
  project,
  year,
  onClose,
  onSave,
}: {
  anchor: HTMLElement;
  project: Project;
  year: number;
  onClose: () => void;
  onSave: (projectId: string, startDate: string, endDate: string) => void;
}) {
  const [startDate, setStartDate] = useState(project.startDate ?? `${year}-01-01`);
  const [endDate, setEndDate] = useState(project.endDate ?? `${year}-03-31`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!project.backendId || saving) return;
    if (!startDate || !endDate || startDate > endDate) {
      setError('Please choose a valid start and end date.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchProject(project.backendId, {
        start_date: startDate,
        end_date: endDate,
      });
      onSave(project.id, startDate, endDate);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project range.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailPopover anchor={anchor} onClose={onClose} className="w-[23rem]" title="Project Range">
      <div className="flex flex-col gap-3.5">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
          <div className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            {project.title}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            Set the timeline range for this existing project.
          </div>
        </div>
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
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/15 bg-[var(--color-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:brightness-[0.985] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save range
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
  defaultGoalId,
  year,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onCreate: (milestone: Milestone) => void;
  goals: Goal[];
  defaultGoalId: number | null;
  year: number;
}) {
  const [goalId, setGoalId] = useState<string>(defaultGoalId ? String(defaultGoalId) : '');
  const [name, setName] = useState('');
  const [type, setType] = useState<MilestoneType>('major');
  const [date, setDate] = useState(`${year}-06-15`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goalId && goals[0]?.backendId) {
      setGoalId(String(goals[0].backendId));
    }
  }, [goalId, goals]);

  const handleSubmit = async () => {
    const numericGoalId = Number.parseInt(goalId, 10);
    if (!name.trim() || Number.isNaN(numericGoalId) || saving) return;
    setSaving(true);
    setError(null);
    try {
      const milestone = await createMilestone({
        goalId: numericGoalId,
        name: name.trim(),
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
            <PopoverField label="Goal">
              <select value={goalId} onChange={(event) => setGoalId(event.target.value)} className="ui-input">
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.backendId}>
                    {goal.name}
                  </option>
                ))}
              </select>
            </PopoverField>
            <PopoverField label="Name">
              <PopoverInput value={name} onChange={setName} placeholder="Milestone name" />
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
            disabled={saving || !goals.length || !name.trim() || !goalId}
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
  onClose,
  onSave,
  onDelete,
}: {
  anchor: HTMLElement;
  milestone: Milestone;
  goals: Goal[];
  onClose: () => void;
  onSave: (nextMilestone: Milestone) => void;
  onDelete: (milestoneId: string) => void;
}) {
  const [goalId, setGoalId] = useState(String(milestone.goalId));
  const [name, setName] = useState(milestone.name);
  const [type, setType] = useState<MilestoneType>(milestone.type);
  const [date, setDate] = useState(milestone.date);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!milestone.backendId || saving) return;
    const numericGoalId = Number.parseInt(goalId, 10);
    if (!name.trim() || Number.isNaN(numericGoalId)) return;
    setSaving(true);
    setError(null);
    try {
      await patchMilestone(milestone.backendId, {
        goal_id: numericGoalId,
        name: name.trim(),
        type,
        date,
      });
      onSave({
        ...milestone,
        goalId: numericGoalId,
        name: name.trim(),
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
        <PopoverField label="Goal">
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)} className="ui-input">
            {goals.map((goal) => (
              <option key={goal.id} value={goal.backendId}>
                {goal.name}
              </option>
            ))}
          </select>
        </PopoverField>
        <PopoverField label="Name">
          <PopoverInput value={name} onChange={setName} placeholder="Milestone name" />
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

export function PlannerView() {
  const currentDate = usePlannerStore((state) => state.currentDate);
  const fallbackProjects = usePlannerStore((state) => state.projects);
  const year = parseISO(currentDate).getFullYear();
  const [zoom, setZoom] = useState<PlannerZoom>('month');
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

  const plannerData = useMemo<PlannerData>(
    () => planner ?? { goals: [], projects: fallbackProjects },
    [planner, fallbackProjects],
  );
  const canPersist = planner !== null;
  const selectedGoalBackendId = plannerData.goals[0]?.backendId ?? null;

  const rows = useMemo(
    () => buildRows(plannerData.goals, plannerData.projects),
    [plannerData],
  );
  const projectItemIds = useMemo(
    () => rows.filter((row): row is Extract<PlannerRow, { kind: 'project' }> => row.kind === 'project').map((row) => row.id),
    [rows],
  );
  const segments = useMemo(() => buildPlannerSegments(year, zoom), [year, zoom]);
  const contentWidth = TIMELINE_MIN_WIDTH[zoom];
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

  const startMilestoneInteraction = useCallback((
    backendId: number | undefined,
    date: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!canPersist || !backendId || !timelineCanvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = timelineCanvasRef.current.getBoundingClientRect();
    setInteraction({
      kind: 'milestone',
      mode: 'move',
      backendId,
      originX: event.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      initialDate: date,
      snapshot: plannerData,
    });
  }, [canPersist, plannerData]);

  useEffect(() => {
    if (!interaction) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const currentDateValue = xToDate(event.clientX - interaction.rectLeft, interaction.rectWidth, year, zoom);
      const originDateValue = xToDate(interaction.originX - interaction.rectLeft, interaction.rectWidth, year, zoom);
      const deltaDays = differenceInCalendarDays(currentDateValue, originDateValue);

      if (interaction.kind === 'milestone') {
        const nextDate = format(
          clampDateToYear(addDays(parseISO(interaction.initialDate), deltaDays), year),
          'yyyy-MM-dd',
        );
        setPlanner((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            goals: prev.goals.map((goal) => ({
              ...goal,
              milestones: goal.milestones.map((milestone) =>
                milestone.backendId === interaction.backendId
                  ? { ...milestone, date: nextDate }
                  : milestone,
              ),
            })),
          };
        });
        return;
      }

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

          const nextMilestone = currentPlanner.goals
            .flatMap((goal) => goal.milestones)
            .find((milestone) => milestone.backendId === interaction.backendId);
          const previousMilestone = snapshot.goals
            .flatMap((goal) => goal.milestones)
            .find((milestone) => milestone.backendId === interaction.backendId);
          if (!nextMilestone || !previousMilestone || nextMilestone.date === previousMilestone.date) return;
          await patchMilestone(interaction.backendId, { date: nextMilestone.date });
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

  const handleProjectDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveDraggedProjectId(null);
    if (!canPersist || !planner || !over || active.id === over.id) return;
    const activeData = active.data.current;
    const overData = over.data.current;
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
    setPlanner({ ...planner, projects: nextProjects });

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
  }, [canPersist, planner]);

  const handleProjectDragStart = useCallback(({ active }: DragStartEvent) => {
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
        onZoomChange={setZoom}
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
          defaultGoalId={selectedGoalBackendId}
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
        return (
          <PlannerProjectRangePopover
            anchor={projectRangePopover.anchor}
            project={project}
            year={year}
            onClose={() => setProjectRangePopover(null)}
            onSave={(projectId, startDate, endDate) => {
              setPlanner((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  projects: prev.projects.map((item) =>
                    item.id === projectId
                      ? { ...item, startDate, endDate }
                      : item,
                  ),
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
              onDragStart={handleProjectDragStart}
              onDragEnd={handleProjectDragEnd}
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
                        return <GoalLabelRow key={row.id} row={row} />;
                      }

                      if (row.kind === 'project') {
                        return (
                          <SortableProjectLabelRow
                            key={row.id}
                            row={row}
                            isGhosted={activeDraggedProjectId === row.project.id}
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

                      return <div key={row.id} style={{ height: row.height }} />;
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
                        const milestoneLayoutMap = getMilestoneLabelLayoutMap(row.goal.milestones);
                        return (
                          <div
                            key={row.id}
                              className="relative border-b border-[var(--color-border)]/55"
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
                              {row.goal.milestones.map((milestone) => (
                                <MilestoneMarker
                                  key={milestone.id}
                                  milestone={milestone}
                                  year={year}
                                  lane={milestoneLayoutMap.get(milestone.id)?.lane ?? 0}
                                  labelOffset={milestoneLayoutMap.get(milestone.id)?.offset ?? 0}
                                  onMoveStart={(event) =>
                                    startMilestoneInteraction(milestone.backendId, milestone.date, event)
                                  }
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
                            </div>
                          );
                        }

                        if (row.kind === 'project') {
                          const outside = isProjectOutsideGoal(row.project, row.goal);
                          const color = outside ? '#f59e0b' : row.goal?.color ?? '#94a3b8';
                          return (
                            <div
                              key={row.id}
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
                            </div>
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

                        return <div key={row.id} style={{ height: row.height }} />;
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
