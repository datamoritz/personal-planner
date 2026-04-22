'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { deleteTaskAllocation, fetchWorkload, upsertTaskAllocation } from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { WorkloadData, WorkloadProjectRollup, WorkloadTaskRow } from '@/types';

function hoursText(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

function cellKey(taskId: number, date: string): string {
  return `${taskId}:${date}`;
}

export function WorkloadView() {
  const projects = usePlannerStore((state) => state.projects);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [workload, setWorkload] = useState<WorkloadData | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<number[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startDate = format(weekStart, 'yyyy-MM-dd');
  const endDate = format(addDays(weekStart, 6), 'yyyy-MM-dd');

  const loadWorkload = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchWorkload(startDate, endDate);
      setWorkload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workload.');
    }
  }, [endDate, startDate]);

  useEffect(() => {
    void loadWorkload();
  }, [loadWorkload]);

  const daySummaries = useMemo(() => workload?.daySummaries ?? [], [workload?.daySummaries]);
  const tasks = useMemo(() => workload?.tasks ?? [], [workload?.tasks]);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.taskId, task])), [tasks]);
  const rollupsByProject = useMemo(
    () => new Map((workload?.projectRollups ?? []).map((rollup) => [rollup.projectId ?? -1, rollup])),
    [workload?.projectRollups],
  );

  const tasksByProject = useMemo(() => {
    const grouped = new Map<number | undefined, WorkloadTaskRow[]>();
    for (const task of tasks) {
      const key = task.projectId;
      const current = grouped.get(key) ?? [];
      current.push(task);
      grouped.set(key, current);
    }
    return grouped;
  }, [tasks]);

  const visibleProjectRollups = useMemo(() => {
    const orderedProjects = projects
      .filter((project) => tasksByProject.has(project.backendId))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const knownRollups: WorkloadProjectRollup[] = orderedProjects
      .map((project) => rollupsByProject.get(project.backendId ?? -1))
      .filter((rollup): rollup is WorkloadProjectRollup => Boolean(rollup));
    const missingRollups = (workload?.projectRollups ?? []).filter(
      (rollup) => rollup.projectId != null && !orderedProjects.some((project) => project.backendId === rollup.projectId),
    );
    return [...knownRollups, ...missingRollups];
  }, [projects, rollupsByProject, tasksByProject, workload?.projectRollups]);

  const unassignedTasks = tasksByProject.get(undefined) ?? [];

  const getDisplayedCellHours = useCallback(
    (taskId: number, date: string) => {
      const key = cellKey(taskId, date);
      if (Object.prototype.hasOwnProperty.call(drafts, key)) {
        const raw = drafts[key].trim();
        if (raw === '') return 0;
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      const task = taskMap.get(taskId);
      const allocation = task?.allocations.find((entry) => entry.allocationDate === date);
      return allocation?.hours ?? 0;
    },
    [drafts, taskMap],
  );

  const getDisplayedTaskTotals = useCallback(
    (task: WorkloadTaskRow) => {
      const originalWeekHours = task.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
      const displayedWeekHours = daySummaries.reduce(
        (sum, day) => sum + getDisplayedCellHours(task.taskId, day.date),
        0,
      );
      const totalAllocatedHours = roundHours(task.totalAllocatedHours - originalWeekHours + displayedWeekHours);
      return {
        totalAllocatedHours,
        remainingHours: roundHours(task.estimateHours - totalAllocatedHours),
      };
    },
    [daySummaries, getDisplayedCellHours],
  );

  const getDisplayedProjectDayHours = useCallback(
    (projectId: number | undefined, date: string) => {
      return roundHours(
        (tasksByProject.get(projectId) ?? []).reduce(
          (sum, task) => sum + getDisplayedCellHours(task.taskId, date),
          0,
        ),
      );
    },
    [getDisplayedCellHours, tasksByProject],
  );

  const getDisplayedProjectTotals = useCallback(
    (projectId: number | undefined) => {
      const projectTasks = tasksByProject.get(projectId) ?? [];
      return projectTasks.reduce(
        (acc, task) => {
          const totals = getDisplayedTaskTotals(task);
          acc.totalEstimatedHours += task.estimateHours;
          acc.totalAllocatedHours += totals.totalAllocatedHours;
          acc.totalRemainingHours += totals.remainingHours;
          acc.taskCount += 1;
          return acc;
        },
        {
          totalEstimatedHours: 0,
          totalAllocatedHours: 0,
          totalRemainingHours: 0,
          taskCount: 0,
        },
      );
    },
    [getDisplayedTaskTotals, tasksByProject],
  );

  const displayedDaySummaries = useMemo(() => {
    return daySummaries.map((day) => {
      const allocatedHours = roundHours(
        tasks.reduce((sum, task) => sum + getDisplayedCellHours(task.taskId, day.date), 0),
      );
      return {
        ...day,
        allocatedHours,
        remainingHours: roundHours(day.capacityHours - allocatedHours),
      };
    });
  }, [daySummaries, getDisplayedCellHours, tasks]);

  const toggleProject = (projectId: number) => {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((value) => value !== projectId)
        : [...current, projectId],
    );
  };

  const commitCell = async (taskId: number, date: string) => {
    const key = cellKey(taskId, date);
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) return;
    const raw = drafts[key].trim();
    const nextValue = raw === '' ? 0 : Number.parseFloat(raw);
    if (!Number.isFinite(nextValue) || nextValue < 0) return;

    const task = taskMap.get(taskId);
    const existing = task?.allocations.find((allocation) => allocation.allocationDate === date);
    const nextHours = roundHours(nextValue);
    setSavingCellKey(key);
    try {
      if (nextHours === 0) {
        if (existing) await deleteTaskAllocation(taskId, date);
        setWorkload((current) => current ? {
          ...current,
          tasks: current.tasks.map((row) =>
            row.taskId === taskId
              ? {
                  ...row,
                  allocations: row.allocations.filter((allocation) => allocation.allocationDate !== date),
                }
              : row,
          ),
        } : current);
      } else {
        const saved = await upsertTaskAllocation({ taskId, allocationDate: date, hours: nextHours });
        setWorkload((current) => current ? {
          ...current,
          tasks: current.tasks.map((row) =>
            row.taskId === taskId
              ? {
                  ...row,
                  allocations: [
                    ...row.allocations.filter((allocation) => allocation.allocationDate !== date),
                    saved,
                  ].sort((a, b) => a.allocationDate.localeCompare(b.allocationDate)),
                }
              : row,
          ),
        } : current);
      }

      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save allocation.');
    } finally {
      setSavingCellKey(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.9rem] border border-[var(--color-border)] bg-[var(--color-canvas)] shadow-[var(--shadow-app)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
          Workload
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setWeekStart((current) => addDays(current, -7))} className="ui-icon-button">
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <div className="text-[1rem] font-semibold text-[var(--color-text-primary)]">
            {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
          </div>
          <button type="button" onClick={() => setWeekStart((current) => addDays(current, 7))} className="ui-icon-button">
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          className="rounded-full bg-[var(--color-accent-subtle)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--color-accent)]"
        >
          Current week
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-20 bg-[var(--color-canvas)]">
            <tr>
              <th className="sticky left-0 z-30 w-[22rem] border-b border-r border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                Task / Project
              </th>
              {displayedDaySummaries.map((day) => (
                <th
                  key={day.date}
                  className="border-b border-[var(--color-border)] px-2 py-2 text-center"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                    {format(new Date(`${day.date}T00:00:00`), 'EEE')}
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold text-[var(--color-text-primary)]">
                    {format(new Date(`${day.date}T00:00:00`), 'MMM d')}
                  </div>
                  <div
                    className={[
                      'mt-1 text-[10px] font-medium',
                      day.remainingHours < 0
                        ? 'text-red-600'
                        : day.remainingHours === 0
                          ? 'text-[var(--color-text-muted)]'
                          : 'text-emerald-600',
                    ].join(' ')}
                  >
                    {hoursText(day.allocatedHours)} / {hoursText(day.capacityHours)}
                  </div>
                </th>
              ))}
              {['Est', 'Planned', 'Remain'].map((label) => (
                <th
                  key={label}
                  className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleProjectRollups.map((rollup) => {
              const projectId = rollup.projectId;
              if (projectId == null) return null;
              const isExpanded = expandedProjectIds.includes(projectId);
              const projectTotals = getDisplayedProjectTotals(projectId);
              const projectTasks = tasksByProject.get(projectId) ?? [];
              return (
                <Fragment key={`project-block-${projectId}`}>
                  <tr key={`project-${projectId}`} className="bg-[var(--color-surface)]/55">
                    <td className="sticky left-0 z-10 border-b border-r border-[var(--color-border)] bg-[var(--color-surface)]/90 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleProject(projectId)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} className="rotate-180" />}
                        <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {rollup.projectTitle}
                        </span>
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          {projectTotals.taskCount} tasks
                        </span>
                      </button>
                    </td>
                    {displayedDaySummaries.map((day) => (
                      <td key={`project-${projectId}-${day.date}`} className="border-b border-[var(--color-border)] px-2 py-2 text-center text-[12px] font-medium text-[var(--color-text-secondary)]">
                        {getDisplayedProjectDayHours(projectId, day.date) > 0 ? hoursText(getDisplayedProjectDayHours(projectId, day.date)) : '—'}
                      </td>
                    ))}
                    <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                      {hoursText(roundHours(projectTotals.totalEstimatedHours))}
                    </td>
                    <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                      {hoursText(roundHours(projectTotals.totalAllocatedHours))}
                    </td>
                    <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                      {hoursText(roundHours(projectTotals.totalRemainingHours))}
                    </td>
                  </tr>
                  {isExpanded && projectTasks.map((task) => {
                    const taskTotals = getDisplayedTaskTotals(task);
                    return (
                      <tr key={`task-${task.taskId}`}>
                        <td className="sticky left-0 z-10 border-b border-r border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-2.5">
                          <div className="flex items-center gap-2 pl-6">
                            <span className="text-[var(--color-text-muted)]">↳</span>
                            <span className="truncate text-[13px] text-[var(--color-text-primary)]">{task.title}</span>
                          </div>
                        </td>
                        {displayedDaySummaries.map((day) => {
                          const key = cellKey(task.taskId, day.date);
                          const value = Object.prototype.hasOwnProperty.call(drafts, key)
                            ? drafts[key]
                            : (() => {
                                const allocation = task.allocations.find((entry) => entry.allocationDate === day.date);
                                return allocation ? String(allocation.hours) : '';
                              })();
                          return (
                            <td key={key} className="border-b border-[var(--color-border)] px-2 py-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={value}
                                onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                                onBlur={() => void commitCell(task.taskId, day.date)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.currentTarget.blur();
                                  }
                                }}
                                className={[
                                  'ui-input h-9 text-center text-[12px]',
                                  savingCellKey === key ? 'opacity-70' : '',
                                ].join(' ')}
                              />
                            </td>
                          );
                        })}
                        <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] text-[var(--color-text-primary)]">
                          {hoursText(task.estimateHours)}
                        </td>
                        <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] text-[var(--color-text-primary)]">
                          {hoursText(taskTotals.totalAllocatedHours)}
                        </td>
                        <td
                          className={[
                            'border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-medium',
                            taskTotals.remainingHours < 0 ? 'text-red-600' : taskTotals.remainingHours === 0 ? 'text-emerald-600' : 'text-[var(--color-text-primary)]',
                          ].join(' ')}
                        >
                          {hoursText(taskTotals.remainingHours)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}

            {unassignedTasks.length > 0 && (
              <>
                <tr className="bg-[var(--color-surface)]/35">
                  <td className="sticky left-0 z-10 border-b border-r border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                    Unassigned
                  </td>
                  {displayedDaySummaries.map((day) => (
                    <td key={`unassigned-${day.date}`} className="border-b border-[var(--color-border)] px-2 py-2 text-center text-[12px] font-medium text-[var(--color-text-secondary)]">
                      {getDisplayedProjectDayHours(undefined, day.date) > 0 ? hoursText(getDisplayedProjectDayHours(undefined, day.date)) : '—'}
                    </td>
                  ))}
                  {(() => {
                    const totals = getDisplayedProjectTotals(undefined);
                    return (
                      <>
                        <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                          {hoursText(roundHours(totals.totalEstimatedHours))}
                        </td>
                        <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                          {hoursText(roundHours(totals.totalAllocatedHours))}
                        </td>
                        <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-semibold text-[var(--color-text-primary)]">
                          {hoursText(roundHours(totals.totalRemainingHours))}
                        </td>
                      </>
                    );
                  })()}
                </tr>
                {unassignedTasks.map((task) => {
                  const taskTotals = getDisplayedTaskTotals(task);
                  return (
                    <tr key={`task-${task.taskId}`}>
                      <td className="sticky left-0 z-10 border-b border-r border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-2.5">
                        <span className="truncate text-[13px] text-[var(--color-text-primary)]">{task.title}</span>
                      </td>
                      {displayedDaySummaries.map((day) => {
                        const key = cellKey(task.taskId, day.date);
                        const value = Object.prototype.hasOwnProperty.call(drafts, key)
                          ? drafts[key]
                          : (() => {
                              const allocation = task.allocations.find((entry) => entry.allocationDate === day.date);
                              return allocation ? String(allocation.hours) : '';
                            })();
                        return (
                          <td key={key} className="border-b border-[var(--color-border)] px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={value}
                              onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                              onBlur={() => void commitCell(task.taskId, day.date)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur();
                              }}
                              className={[
                                'ui-input h-9 text-center text-[12px]',
                                savingCellKey === key ? 'opacity-70' : '',
                              ].join(' ')}
                            />
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] text-[var(--color-text-primary)]">
                        {hoursText(task.estimateHours)}
                      </td>
                      <td className="border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] text-[var(--color-text-primary)]">
                        {hoursText(taskTotals.totalAllocatedHours)}
                      </td>
                      <td
                        className={[
                          'border-b border-l border-[var(--color-border)] px-3 py-2 text-right text-[12px] font-medium',
                          taskTotals.remainingHours < 0 ? 'text-red-600' : taskTotals.remainingHours === 0 ? 'text-emerald-600' : 'text-[var(--color-text-primary)]',
                        ].join(' ')}
                      >
                        {hoursText(taskTotals.remainingHours)}
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="border-t border-[var(--color-border)] px-6 py-3 text-[12px] text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
