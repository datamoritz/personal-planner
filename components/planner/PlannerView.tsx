'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Flag, FolderPlus, MilestoneIcon, Plus } from 'lucide-react';
import { format, isSameYear, parseISO } from 'date-fns';
import { fetchPlanner, type PlannerData } from '@/lib/api';
import { buildPlannerSegments, dateToPercent, rangeToPercent } from '@/lib/plannerTimeline';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { Goal, Milestone, PlannerZoom, Project } from '@/types';

type PlannerRow =
  | { id: string; kind: 'goal'; goal: Goal; height: number }
  | { id: string; kind: 'project'; goal: Goal | null; project: Project; height: number }
  | { id: string; kind: 'add-project'; goal: Goal; height: number }
  | { id: string; kind: 'unassigned-label'; height: number }
  | { id: string; kind: 'group-gap'; height: number };

const LABEL_WIDTH = 228;
const TIMELINE_MIN_WIDTH: Record<PlannerZoom, number> = {
  week: 1680,
  month: 1120,
  quarter: 980,
};

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
    rows.push({ id: `goal-${goal.id}`, kind: 'goal', goal, height: 64 });
    const goalProjects = [...(byGoalId.get(goal.backendId ?? -1) ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    for (const project of goalProjects) {
      rows.push({ id: `project-${project.id}`, kind: 'project', goal, project, height: 52 });
    }
    rows.push({ id: `goal-add-${goal.id}`, kind: 'add-project', goal, height: 36 });
    rows.push({ id: `goal-gap-${goal.id}`, kind: 'group-gap', height: 16 });
  }

  rows.push({ id: 'unassigned-label', kind: 'unassigned-label', height: 42 });
  for (const project of [...unassigned].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    rows.push({ id: `project-${project.id}`, kind: 'project', goal: null, project, height: 52 });
  }

  return rows;
}

function TimelinePlaceholder({
  label,
}: {
  label: string;
}) {
  return (
    <div className="absolute inset-y-0 left-5 flex items-center">
      <div className="rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-1 text-[10px] font-medium tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
        {label}
      </div>
    </div>
  );
}

function MilestoneMarker({
  milestone,
  year,
  color,
}: {
  milestone: Milestone;
  year: number;
  color: string;
}) {
  const left = dateToPercent(milestone.date, year) * 100;
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2"
      style={{ left: `calc(${left}% - 7px)` }}
    >
      <div
        className="absolute -top-5 left-1/2 w-24 -translate-x-1/2 text-center text-[10px] font-medium text-[var(--color-text-muted)]"
      >
        {milestone.name}
      </div>
      <div
        className="h-3.5 w-3.5 rotate-45 rounded-[3px] border shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
        style={{
          background: `linear-gradient(135deg, ${hexToRgba(color, 0.95)}, ${hexToRgba(color, 0.78)})`,
          borderColor: hexToRgba(color, 0.2),
        }}
      />
    </div>
  );
}

function PlannerToolbar({
  year,
  zoom,
  onZoomChange,
}: {
  year: number;
  zoom: PlannerZoom;
  onZoomChange: (zoom: PlannerZoom) => void;
}) {
  const { navigateYear, setCurrentDate } = usePlannerStore();

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] opacity-60"
        >
          <Flag size={13} />
          Goal
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] opacity-60"
        >
          <MilestoneIcon size={13} />
          Milestone
        </button>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] opacity-60"
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
        {(['week', 'month', 'quarter'] as const).map((option) => {
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
              {option === 'week' ? 'Week' : option === 'month' ? 'Month' : 'Quarter'}
            </button>
          );
        })}
      </div>
    </div>
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

  const projects = planner?.projects?.length ? planner.projects : fallbackProjects;
  const rows = useMemo(
    () => buildRows(planner?.goals ?? [], projects),
    [planner, projects],
  );
  const segments = useMemo(() => buildPlannerSegments(year, zoom), [year, zoom]);
  const contentWidth = TIMELINE_MIN_WIDTH[zoom];
  const totalRowHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const today = new Date();
  const todayPercent = isSameYear(today, new Date(year, 0, 1))
    ? dateToPercent(today, year) * 100
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-canvas)]">
      <PlannerToolbar year={year} zoom={zoom} onZoomChange={setZoom} />

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
          Loading planner…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          {error && (
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/75 px-6 py-2 text-[12px] text-[var(--color-text-muted)]">
              Planner backend unavailable right now. Showing local project preview.
            </div>
          )}
          {!rows.length ? (
            <div className="flex min-h-full items-center justify-center px-6">
              <div className="max-w-md rounded-[1.5rem] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5 text-center text-sm text-[var(--color-text-muted)]">
                Add your first goal or assign project dates to start mapping longer-term work here.
              </div>
            </div>
          ) : (
          <div
            className="grid min-h-full"
            style={{
              gridTemplateColumns: `${LABEL_WIDTH}px minmax(${contentWidth}px, 1fr)`,
              minWidth: LABEL_WIDTH + contentWidth,
            }}
          >
            <div className="sticky left-0 z-20 border-r border-[var(--color-border)] bg-[var(--color-canvas)]">
              <div className="sticky top-0 z-10 h-12 border-b border-[var(--color-border)] bg-[var(--color-canvas)]" />
              {rows.map((row) => {
                if (row.kind === 'goal') {
                  return (
                    <div
                      key={row.id}
                      className="flex items-center gap-3 border-b border-[var(--color-border)]/55 px-4"
                      style={{ height: row.height }}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: row.goal.color }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {row.goal.name}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-muted)]">
                          {format(parseISO(row.goal.startDate), 'MMM d')} - {format(parseISO(row.goal.endDate), 'MMM d')}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'project') {
                  const outside = isProjectOutsideGoal(row.project, row.goal);
                  return (
                    <div
                      key={row.id}
                      className="flex items-center gap-3 border-b border-[var(--color-border)]/40 px-4"
                      style={{ height: row.height }}
                    >
                      <span className="text-[var(--color-text-muted)]">↳</span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-[var(--color-text-primary)]">
                          {row.project.title}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-muted)]">
                          {outside ? 'Extends beyond goal range' : row.project.startDate && row.project.endDate
                            ? `${format(parseISO(row.project.startDate), 'MMM d')} - ${format(parseISO(row.project.endDate), 'MMM d')}`
                            : 'No timeline yet'}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (row.kind === 'add-project') {
                  return (
                    <div
                      key={row.id}
                      className="flex items-center border-b border-[var(--color-border)]/25 px-4"
                      style={{ height: row.height }}
                    >
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] font-medium text-[var(--color-text-muted)] opacity-70"
                      >
                        <Plus size={12} />
                        Add project
                      </button>
                    </div>
                  );
                }

                if (row.kind === 'unassigned-label') {
                  return (
                    <div
                      key={row.id}
                      className="flex items-center border-y border-[var(--color-border)] bg-[var(--color-surface)]/45 px-4"
                      style={{ height: row.height }}
                    >
                      <div className="text-[12px] font-semibold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                        Unassigned
                      </div>
                    </div>
                  );
                }

                return <div key={row.id} style={{ height: row.height }} />;
              })}
            </div>

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
                    {zoom === 'month' ? segment.label : segment.label}
                  </div>
                ))}
              </div>

              <div className="relative" style={{ minHeight: totalRowHeight }}>
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
                    className="pointer-events-none absolute top-0 bottom-0 z-[1] w-px bg-[var(--color-accent)]/45"
                    style={{ left: `${todayPercent}%` }}
                  />
                )}

                <div className="relative z-[2]">
                  {rows.map((row) => {
                    if (row.kind === 'goal') {
                      const range = rangeToPercent(row.goal.startDate, row.goal.endDate, year);
                      return (
                        <div
                          key={row.id}
                          className="relative border-b border-[var(--color-border)]/55"
                          style={{ height: row.height }}
                        >
                          <div
                            className="absolute left-0 right-0 top-1/2 h-[10px] -translate-y-1/2 rounded-full border shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
                            style={{
                              ...plannerBarStyle(row.goal.color, 0.94),
                              left: `${range.left * 100}%`,
                              width: `${range.width * 100}%`,
                            }}
                          />
                          {row.goal.milestones.map((milestone) => (
                            <MilestoneMarker
                              key={milestone.id}
                              milestone={milestone}
                              year={year}
                              color={row.goal.color}
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
                          style={{ height: row.height }}
                        >
                          {row.project.startDate && row.project.endDate ? (
                            <div
                              className="absolute left-0 right-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full border"
                              style={{
                                ...plannerBarStyle(color, outside ? 0.46 : 0.3),
                                left: `${rangeToPercent(row.project.startDate, row.project.endDate, year).left * 100}%`,
                                width: `${rangeToPercent(row.project.startDate, row.project.endDate, year).width * 100}%`,
                              }}
                            />
                          ) : (
                            <TimelinePlaceholder label="No range" />
                          )}
                        </div>
                      );
                    }

                    if (row.kind === 'add-project') {
                      return (
                        <div
                          key={row.id}
                          className="relative border-b border-[var(--color-border)]/25"
                          style={{ height: row.height }}
                        >
                          <div className="absolute inset-x-5 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-[var(--color-border)]/70" />
                        </div>
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
          )}
        </div>
      )}
    </div>
  );
}
