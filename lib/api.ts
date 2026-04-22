/**
 * Typed API client for the Planner backend.
 *
 * Responsibilities:
 * - All field-name mapping between frontend (camelCase) and backend (snake_case)
 * - RecurrenceFrequency ↔ recurrence_rule string conversion
 * - Time format normalisation: backend "HH:MM:SS" ↔ frontend "HH:MM"
 * - FK resolution: backend integer IDs ↔ frontend UUID client_ids
 * - nextDueDate computation for RecurrentTask (client-only field)
 *
 * No React / Zustand imports — this is a pure data layer.
 */

import { addDays, addMonths, format, startOfDay, startOfMonth } from 'date-fns';
import type {
  Task,
  Project,
  Goal,
  Milestone,
  MilestoneType,
  WorkloadAllocation,
  WorkloadData,
  WorkloadDaySummary,
  WorkloadProjectRollup,
  WorkloadTaskRow,
  RecurrentTask,
  RecurrenceFrequency,
  CalendarEntry,
  AllDayEvent,
  Tag,
  RecentEmail,
  EmailContent,
  EmailTaskSuggestion,
  TextDraftMode,
  TextDraftResponse,
  AppleBirthdayMessage,
  WatchSearchResult,
} from '@/types';

export const API_BASE = 'https://planner-api.moritzknodler.com';

export function normalizeExecutionView(
  view: string | null | undefined,
): 'day' | 'week' | 'month' | 'year' {
  if (view === 'week' || view === 'month' || view === 'year') return view;
  return 'day';
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API ${options?.method ?? 'GET'} ${path} → ${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get  = <T>(path: string)                   => request<T>(path);
const post = <T>(path: string, body: unknown)    => request<T>(path, { method: 'POST',   body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown)   => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) });
const del  = (path: string)                      => request<void>(path, { method: 'DELETE' });

// ─── Recurrence helpers ─────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function frequencyToRule(freq: RecurrenceFrequency): string {
  switch (freq.type) {
    case 'daily':   return 'daily';
    case 'weekly':  return `weekly:${WEEKDAY_NAMES[freq.dayOfWeek]}`;
    case 'monthly': return `monthly:${freq.dayOfMonth}`;
    case 'custom-days':   return `custom-days:${freq.intervalDays}`;
    case 'custom-weeks':  return `custom-weeks:${freq.intervalWeeks}:${WEEKDAY_NAMES[freq.dayOfWeek]}`;
    case 'custom-months': return `custom-months:${freq.intervalMonths}:${freq.dayOfMonth}`;
  }
}

export function ruleToFrequency(rule: string): RecurrenceFrequency {
  if (rule === 'daily') return { type: 'daily' };

  if (rule.startsWith('weekly:')) {
    const day = rule.split(':')[1] as typeof WEEKDAY_NAMES[number];
    const dayOfWeek = WEEKDAY_NAMES.indexOf(day);
    if (dayOfWeek !== -1) return { type: 'weekly', dayOfWeek };
  }

  if (rule.startsWith('monthly:')) {
    const dayOfMonth = parseInt(rule.split(':')[1], 10);
    if (!isNaN(dayOfMonth)) return { type: 'monthly', dayOfMonth };
  }

  if (rule.startsWith('custom-days:')) {
    const intervalDays = parseInt(rule.split(':')[1], 10);
    if (!isNaN(intervalDays)) return { type: 'custom-days', intervalDays };
  }

  if (rule.startsWith('custom-weeks:')) {
    const [, intervalRaw, dayRaw] = rule.split(':');
    const intervalWeeks = parseInt(intervalRaw, 10);
    const dayOfWeek = WEEKDAY_NAMES.indexOf(dayRaw as typeof WEEKDAY_NAMES[number]);
    if (!isNaN(intervalWeeks) && dayOfWeek !== -1) {
      return { type: 'custom-weeks', intervalWeeks, dayOfWeek };
    }
  }

  if (rule.startsWith('custom-months:')) {
    const [, intervalRaw, dayRaw] = rule.split(':');
    const intervalMonths = parseInt(intervalRaw, 10);
    const dayOfMonth = parseInt(dayRaw, 10);
    if (!isNaN(intervalMonths) && !isNaN(dayOfMonth)) {
      return { type: 'custom-months', intervalMonths, dayOfMonth };
    }
  }

  // Unknown rule: fall back to daily
  return { type: 'daily' };
}

function parseLocalDate(value: string | Date): Date {
  return value instanceof Date ? startOfDay(value) : new Date(`${value}T00:00:00`);
}

function isoDate(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return isoDate(a) === isoDate(b);
}

function createMonthDay(year: number, monthIndex: number, dayOfMonth: number): Date | null {
  const candidate = new Date(year, monthIndex, dayOfMonth);
  return candidate.getMonth() === monthIndex ? startOfDay(candidate) : null;
}

function firstWeeklyOnOrAfter(anchor: Date, dayOfWeek: number): Date {
  const offset = (dayOfWeek - anchor.getDay() + 7) % 7;
  return addDays(anchor, offset);
}

function firstMonthlyOnOrAfter(anchor: Date, dayOfMonth: number): Date {
  const sameMonth = createMonthDay(anchor.getFullYear(), anchor.getMonth(), dayOfMonth);
  if (sameMonth && sameMonth >= anchor) return sameMonth;
  let cursor = addMonths(startOfMonth(anchor), 1);
  while (true) {
    const candidate = createMonthDay(cursor.getFullYear(), cursor.getMonth(), dayOfMonth);
    if (candidate) return candidate;
    cursor = addMonths(cursor, 1);
  }
}

function addMonthlyCycle(from: Date, intervalMonths: number, dayOfMonth: number): Date {
  let cursor = addMonths(startOfMonth(from), intervalMonths);
  while (true) {
    const candidate = createMonthDay(cursor.getFullYear(), cursor.getMonth(), dayOfMonth);
    if (candidate) return candidate;
    cursor = addMonths(cursor, 1);
  }
}

export function getCurrentRecurrentCycleDueDate(
  freq: RecurrenceFrequency,
  anchorDate: string,
  referenceDate: string | Date = new Date(),
): string {
  const anchor = parseLocalDate(anchorDate);
  const reference = parseLocalDate(referenceDate);

  switch (freq.type) {
    case 'daily':
      return isoDate(reference < anchor ? anchor : reference);

    case 'weekly': {
      let current = firstWeeklyOnOrAfter(anchor, freq.dayOfWeek);
      while (addDays(current, 7) <= reference) current = addDays(current, 7);
      return isoDate(current);
    }

    case 'monthly': {
      let current = firstMonthlyOnOrAfter(anchor, freq.dayOfMonth);
      while (addMonthlyCycle(current, 1, freq.dayOfMonth) <= reference) {
        current = addMonthlyCycle(current, 1, freq.dayOfMonth);
      }
      return isoDate(current);
    }

    case 'custom-days': {
      const interval = Math.max(1, freq.intervalDays);
      let current = anchor;
      while (addDays(current, interval) <= reference) current = addDays(current, interval);
      return isoDate(current);
    }

    case 'custom-weeks': {
      const intervalDays = Math.max(1, freq.intervalWeeks) * 7;
      let current = firstWeeklyOnOrAfter(anchor, freq.dayOfWeek);
      while (addDays(current, intervalDays) <= reference) current = addDays(current, intervalDays);
      return isoDate(current);
    }

    case 'custom-months': {
      let current = firstMonthlyOnOrAfter(anchor, freq.dayOfMonth);
      while (addMonthlyCycle(current, Math.max(1, freq.intervalMonths), freq.dayOfMonth) <= reference) {
        current = addMonthlyCycle(current, Math.max(1, freq.intervalMonths), freq.dayOfMonth);
      }
      return isoDate(current);
    }
  }
}

export function getNextRecurrentCycleDueDate(
  freq: RecurrenceFrequency,
  dueDate: string,
): string {
  const base = parseLocalDate(dueDate);
  switch (freq.type) {
    case 'daily':
      return isoDate(addDays(base, 1));
    case 'weekly':
      return isoDate(addDays(base, 7));
    case 'monthly':
      return isoDate(addMonthlyCycle(base, 1, freq.dayOfMonth));
    case 'custom-days':
      return isoDate(addDays(base, Math.max(1, freq.intervalDays)));
    case 'custom-weeks':
      return isoDate(addDays(base, Math.max(1, freq.intervalWeeks) * 7));
    case 'custom-months':
      return isoDate(addMonthlyCycle(base, Math.max(1, freq.intervalMonths), freq.dayOfMonth));
  }
}

export function getPreviousRecurrentCycleDueDate(
  freq: RecurrenceFrequency,
  dueDate: string,
  anchorDate: string,
): string | undefined {
  const anchor = parseLocalDate(anchorDate);
  const due = parseLocalDate(dueDate);
  if (isSameLocalDate(anchor, due) || due < anchor) return undefined;

  switch (freq.type) {
    case 'daily':
      return isoDate(addDays(due, -1));
    case 'weekly':
      return isoDate(addDays(due, -7));
    case 'monthly': {
      let current = firstMonthlyOnOrAfter(anchor, freq.dayOfMonth);
      let previous: Date | undefined;
      while (current < due) {
        previous = current;
        current = addMonthlyCycle(current, 1, freq.dayOfMonth);
      }
      return previous ? isoDate(previous) : undefined;
    }
    case 'custom-days':
      return isoDate(addDays(due, -Math.max(1, freq.intervalDays)));
    case 'custom-weeks':
      return isoDate(addDays(due, -Math.max(1, freq.intervalWeeks) * 7));
    case 'custom-months': {
      let current = firstMonthlyOnOrAfter(anchor, freq.dayOfMonth);
      let previous: Date | undefined;
      while (current < due) {
        previous = current;
        current = addMonthlyCycle(current, Math.max(1, freq.intervalMonths), freq.dayOfMonth);
      }
      return previous ? isoDate(previous) : undefined;
    }
  }
}

export function isRecurrentCycleComplete(
  freq: RecurrenceFrequency,
  anchorDate: string,
  completedThroughDate: string | undefined,
  referenceDate: string | Date = new Date(),
): boolean {
  if (!completedThroughDate) return false;
  return completedThroughDate >= getCurrentRecurrentCycleDueDate(freq, anchorDate, referenceDate);
}

/** Compute the next due date shown in UI for a recurrence rule, relative to today and cycle completion. */
export function computeNextDueDate(
  freq: RecurrenceFrequency,
  anchorDate: string,
  completedThroughDate?: string,
): string {
  const currentDueDate = getCurrentRecurrentCycleDueDate(freq, anchorDate);
  return completedThroughDate && completedThroughDate >= currentDueDate
    ? getNextRecurrentCycleDueDate(freq, currentDueDate)
    : currentDueDate;
}

// ─── Time format helpers ────────────────────────────────────────────────────

/** Backend returns "HH:MM:SS" — trim to "HH:MM" for the frontend. */
function fromApiTime(t: string | null | undefined): string | undefined {
  if (!t) return undefined;
  return t.length > 5 ? t.slice(0, 5) : t;
}

/** Frontend uses "HH:MM" — add ":00" for the backend. */
function toApiTime(t: string | undefined): string | null {
  if (!t) return null;
  const [hoursRaw, minutesRaw = '00', secondsRaw = '00'] = t.split(':');
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseInt(secondsRaw, 10);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds)
  ) {
    return t.length === 5 ? `${t}:00` : t;
  }

  const normalizedHours = ((hours % 24) + 24) % 24;
  return `${String(normalizedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ─── Backend → frontend converters ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendTask             = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendProject          = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendGoal             = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendMilestone        = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendRecurrentTask    = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendTag              = any;

function toTask(
  b: BackendTask,
  projectIdMap: Map<number, string>,
  recurrentTaskIdMap: Map<number, string>,
  tagIdMap: Map<number, string>,
): Task {
  return {
    id:               b.client_id ?? String(b.id),
    backendId:        b.id,
    sortOrder:        b.sort_order ?? 0,
    title:            b.title,
    status:           b.status,
    location:         b.location,
    date:             b.task_date ?? undefined,
    startTime:        fromApiTime(b.start_time),
    endTime:          fromApiTime(b.end_time),
    projectId:        b.project_id != null ? projectIdMap.get(b.project_id) : undefined,
    recurrentTaskId:  b.recurrent_task_id != null ? recurrentTaskIdMap.get(b.recurrent_task_id) : undefined,
    tagId:            b.tag_id != null ? tagIdMap.get(b.tag_id) : undefined,
    estimateHours:    b.estimate_hours ?? undefined,
    notes:            b.notes ?? undefined,
    createdAt:        b.created_at,
    updatedAt:        b.updated_at,
  };
}

function toProject(b: BackendProject, tagIdMap: Map<number, string>): Project {
  return {
    id:          b.client_id ?? String(b.id),
    backendId:   b.id,
    goalId:      b.goal_id ?? undefined,
    sortOrder:   b.sort_order ?? 0,
    title:       b.title,
    subtaskIds:  [],  // derived from tasks after full fetch
    status:      b.is_finished ? 'finished' : 'active',
    tagId:       b.tag_id != null ? tagIdMap.get(b.tag_id) : undefined,
    startDate:   b.start_date ?? undefined,
    endDate:     b.end_date ?? undefined,
    createdAt:   b.created_at,
    updatedAt:   b.updated_at,
  };
}

function toMilestone(b: BackendMilestone): Milestone {
  return {
    id:         b.client_id ?? String(b.id),
    backendId:  b.id,
    goalId:     b.goal_id,
    name:       b.name,
    type:       (b.type as MilestoneType | undefined) ?? 'major',
    date:       b.date,
    createdAt:  b.created_at,
    updatedAt:  b.updated_at,
  };
}

function toGoal(b: BackendGoal): Goal {
  return {
    id:         b.client_id ?? String(b.id),
    backendId:  b.id,
    name:       b.name,
    color:      b.color,
    startDate:  b.start_date,
    endDate:    b.end_date,
    milestones: Array.isArray(b.milestones) ? b.milestones.map(toMilestone) : [],
    createdAt:  b.created_at,
    updatedAt:  b.updated_at,
  };
}

function toRecurrentTask(b: BackendRecurrentTask, tagIdMap: Map<number, string>): RecurrentTask {
  const frequency = ruleToFrequency(b.recurrence_rule);
  const anchorDate = b.anchor_date ?? b.created_at?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd');
  const completedThroughDate = b.completed_through_date ?? undefined;
  return {
    id:                   b.client_id ?? String(b.id),
    backendId:            b.id,
    title:                b.title,
    tagId:                b.tag_id != null ? tagIdMap.get(b.tag_id) : undefined,
    frequency,
    anchorDate,
    completedThroughDate,
    nextDueDate:          computeNextDueDate(frequency, anchorDate, completedThroughDate),
    notes:                b.notes ?? undefined,
    createdAt:            b.created_at,
    updatedAt:            b.updated_at,
  };
}

const COLOR_DARK_MAP: Record<string, string> = {
  '#dbeafe': '#3b82f6',
  '#ede9fe': '#8b5cf6',
  '#dcfce7': '#22c55e',
  '#fef9c3': '#eab308',
  '#ffedd5': '#f97316',
  '#fce7f3': '#ec4899',
  '#cffafe': '#06b6d4',
  '#f1f5f9': '#64748b',
};

function darkenHex(hex: string, factor = 0.82): string {
  const clean = hex.toLowerCase().replace('#', '');
  const num = parseInt(clean, 16);

  const r = Math.round(((num >> 16) & 255) * factor);
  const g = Math.round(((num >> 8) & 255) * factor);
  const b = Math.round((num & 255) * factor);

  return `#${[r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function toTag(b: BackendTag): Tag {

  const color = (b.color ?? '#e5e7eb').toLowerCase();

  return {
    id:        b.client_id ?? String(b.id),
    backendId: b.id,
    name:      b.name,
    color,

    // ✅ FIXED
    colorDark:
      b.color_dark ??
      COLOR_DARK_MAP[color] ??
      darkenHex(color),   // <-- key addition

    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

// ─── Boot fetch ─────────────────────────────────────────────────────────────

export interface BootData {
  tasks:           Task[];
  projects:        Project[];
  recurrentTasks:  RecurrentTask[];
  tags:            Tag[];
}

export interface PlannerData {
  goals: Goal[];
  projects: Project[];
}

function toWorkloadAllocation(b: Record<string, unknown>): WorkloadAllocation {
  return {
    id: Number(b.id),
    taskId: Number(b.task_id),
    allocationDate: String(b.allocation_date),
    hours: Number(b.hours ?? 0),
    createdAt: String(b.created_at),
    updatedAt: String(b.updated_at),
  };
}

function toWorkloadTaskRow(b: Record<string, unknown>): WorkloadTaskRow {
  return {
    taskId: Number(b.task_id),
    title: String(b.title),
    projectId: b.project_id == null ? undefined : Number(b.project_id),
    estimateHours: Number(b.estimate_hours ?? 0),
    totalAllocatedHours: Number(b.total_allocated_hours ?? 0),
    remainingHours: Number(b.remaining_hours ?? 0),
    allocations: Array.isArray(b.allocations) ? b.allocations.map((allocation) => toWorkloadAllocation(allocation as Record<string, unknown>)) : [],
  };
}

function toWorkloadDaySummary(b: Record<string, unknown>): WorkloadDaySummary {
  return {
    date: String(b.date),
    weekday: Number(b.weekday),
    capacityHours: Number(b.capacity_hours ?? 0),
    allocatedHours: Number(b.allocated_hours ?? 0),
    remainingHours: Number(b.remaining_hours ?? 0),
  };
}

function toWorkloadProjectRollup(b: Record<string, unknown>): WorkloadProjectRollup {
  return {
    projectId: b.project_id == null ? undefined : Number(b.project_id),
    projectTitle: String(b.project_title),
    totalEstimatedHours: Number(b.total_estimated_hours ?? 0),
    totalAllocatedHours: Number(b.total_allocated_hours ?? 0),
    totalRemainingHours: Number(b.total_remaining_hours ?? 0),
    taskCount: Number(b.task_count ?? 0),
  };
}

export async function fetchAll(): Promise<BootData> {
  const [
    backendProjects,
    backendTags,
    backendRecurrentTasks,
    backendTasks,
  ] = await Promise.all([
    get<BackendProject[]>('/projects'),
    get<BackendTag[]>('/tags'),
    get<BackendRecurrentTask[]>('/recurrent-tasks'),
    get<BackendTask[]>('/tasks'),
  ]);

  // Build FK resolution maps: backend integer id → frontend UUID (client_id)
  const projectIdMap = new Map<number, string>(
    backendProjects.map((p) => [p.id, p.client_id ?? String(p.id)]),
  );
  const recurrentTaskIdMap = new Map<number, string>(
    backendRecurrentTasks.map((r) => [r.id, r.client_id ?? String(r.id)]),
  );
  const tagIdMap = new Map<number, string>(
    backendTags.map((t) => [t.id, t.client_id ?? String(t.id)]),
  );

  const tags            = backendTags.map(toTag);
  const projects        = backendProjects.map((p) => toProject(p, tagIdMap));
  const recurrentTasks  = backendRecurrentTasks.map((r) => toRecurrentTask(r, tagIdMap));
  const tasks           = backendTasks.map((t) => toTask(t, projectIdMap, recurrentTaskIdMap, tagIdMap));

  return { projects, tags, recurrentTasks, tasks };
}

export async function fetchPlanner(): Promise<PlannerData> {
  const [backendPlanner, backendTags] = await Promise.all([
    get<{ goals: BackendGoal[]; projects: BackendProject[] }>('/planner'),
    get<BackendTag[]>('/tags'),
  ]);

  const tagIdMap = new Map<number, string>(
    backendTags.map((t) => [t.id, t.client_id ?? String(t.id)]),
  );

  return {
    goals: backendPlanner.goals.map(toGoal),
    projects: backendPlanner.projects.map((project) => toProject(project, tagIdMap)),
  };
}

export async function fetchWorkload(startDate: string, endDate: string): Promise<WorkloadData> {
  const payload = await get<Record<string, unknown>>(
    `/workload?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
  );
  return {
    startDate: String(payload.start_date),
    endDate: String(payload.end_date),
    tasks: Array.isArray(payload.tasks) ? payload.tasks.map((task) => toWorkloadTaskRow(task as Record<string, unknown>)) : [],
    daySummaries: Array.isArray(payload.day_summaries)
      ? payload.day_summaries.map((summary) => toWorkloadDaySummary(summary as Record<string, unknown>))
      : [],
    projectRollups: Array.isArray(payload.project_rollups)
      ? payload.project_rollups.map((rollup) => toWorkloadProjectRollup(rollup as Record<string, unknown>))
      : [],
  };
}

export async function upsertTaskAllocation(input: {
  taskId: number;
  allocationDate: string;
  hours: number;
}): Promise<WorkloadAllocation> {
  const payload = await post<Record<string, unknown>>('/workload/allocations', {
    task_id: input.taskId,
    allocation_date: input.allocationDate,
    hours: input.hours,
  });
  return toWorkloadAllocation(payload);
}

export async function deleteTaskAllocation(taskId: number, allocationDate: string): Promise<void> {
  await del(`/workload/allocations?task_id=${encodeURIComponent(String(taskId))}&allocation_date=${encodeURIComponent(allocationDate)}`);
}

export async function createGoal(input: {
  name: string;
  color: string;
  startDate: string;
  endDate: string;
}): Promise<Goal> {
  const goal = await post<BackendGoal>('/goals', {
    name: input.name,
    color: input.color,
    start_date: input.startDate,
    end_date: input.endDate,
  });
  return toGoal(goal);
}

export async function patchGoal(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/goals/${backendId}`, fields);
}

export async function createMilestone(input: {
  goalId: number;
  name: string;
  type: MilestoneType;
  date: string;
}): Promise<Milestone> {
  const milestone = await post<BackendMilestone>('/milestones', {
    goal_id: input.goalId,
    name: input.name,
    type: input.type,
    date: input.date,
  });
  return toMilestone(milestone);
}

export async function patchMilestone(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/milestones/${backendId}`, fields);
}

export async function deleteMilestone(backendId: number): Promise<void> {
  await del(`/milestones/${backendId}`);
}

// ─── Task mutations ─────────────────────────────────────────────────────────

function resolveProjectBackendId(projectId: string | undefined, projects: Project[]): number | null {
  if (!projectId) return null;
  return projects.find((p) => p.id === projectId)?.backendId ?? null;
}

function resolveRecurrentTaskBackendId(recId: string | undefined, recurrentTasks: RecurrentTask[]): number | null {
  if (!recId) return null;
  return recurrentTasks.find((r) => r.id === recId)?.backendId ?? null;
}

export function resolveTagBackendId(tagId: string | undefined, tags: Tag[]): number | null {
  if (!tagId) return null;
  return tags.find((t) => t.id === tagId)?.backendId ?? null;
}

export async function createTask(
  task: Task,
  projects: Project[],
  recurrentTasks: RecurrentTask[],
  tags: Tag[],
): Promise<{ id: number }> {
  const payload = {
    client_id:           task.id,
    title:               task.title,
    notes:               task.notes ?? null,
    location:            task.location,
    status:              task.status,
    task_date:           task.date ?? null,
    start_time:          toApiTime(task.startTime),
    end_time:            toApiTime(task.endTime),
    estimate_hours:      task.estimateHours ?? null,
    project_id:          resolveProjectBackendId(task.projectId, projects),
    recurrent_task_id:   resolveRecurrentTaskBackendId(task.recurrentTaskId, recurrentTasks),
    tag_id:              resolveTagBackendId(task.tagId, tags),
    sort_order:          task.sortOrder ?? 0,
  };

  return post<{ id: number }>('/tasks', payload);
}

export async function createTasksBulk(
  tasks: Task[],
  projects: Project[],
  recurrentTasks: RecurrentTask[],
  tags: Tag[],
): Promise<{ count: number; created: Array<{ id: number; client_id?: string | null }> }> {
  return post('/tasks/bulk', {
    tasks: tasks.map((task) => ({
      client_id: task.id,
      title: task.title,
      notes: task.notes ?? null,
      location: task.location,
      status: task.status,
      task_date: task.date ?? null,
      start_time: toApiTime(task.startTime),
      end_time: toApiTime(task.endTime),
      estimate_hours: task.estimateHours ?? null,
      project_id: resolveProjectBackendId(task.projectId, projects),
      recurrent_task_id: resolveRecurrentTaskBackendId(task.recurrentTaskId, recurrentTasks),
      tag_id: resolveTagBackendId(task.tagId, tags),
      sort_order: task.sortOrder ?? 0,
    })),
  });
}

export async function patchTask(backendId: number, fields: Record<string, unknown>): Promise<void> {
  const normalizedFields = { ...fields };
  if ('start_time' in normalizedFields) normalizedFields.start_time = toApiTime(normalizedFields.start_time as string | undefined);
  if ('end_time' in normalizedFields) normalizedFields.end_time = toApiTime(normalizedFields.end_time as string | undefined);
  await patch<unknown>(`/tasks/${backendId}`, normalizedFields);
}

export async function deleteTask(backendId: number): Promise<void> {
  await del(`/tasks/${backendId}`);
}

export async function suggestEmoji(title: string): Promise<string> {
  const res = await post<{ emoji: string }>('/ai/emoji-suggestion', { title });
  return res.emoji;
}

export async function getRecentEmails(): Promise<RecentEmail[]> {
  return get<RecentEmail[]>('/email/recent');
}

export async function getEmailContent(messageId: string): Promise<EmailContent> {
  return get<EmailContent>(`/email/${messageId}`);
}

export async function archiveEmail(messageId: string): Promise<void> {
  await post<void>(`/email/${messageId}/archive`, {});
}

export async function unarchiveEmail(messageId: string): Promise<void> {
  await post<void>(`/email/${messageId}/unarchive`, {});
}

export async function suggestTaskFromEmail(
  messageId: string,
  input: {
    promptAddition?: string;
    currentDate: string;
    currentDateTime: string;
    currentView: 'day' | 'week' | 'month' | 'year';
    timezone: string;
  },
): Promise<EmailTaskSuggestion> {
  return post<EmailTaskSuggestion>(`/email/${messageId}/task-suggestion`, {
    promptAddition: input.promptAddition?.trim() || undefined,
    currentDate: input.currentDate,
    currentDateTime: input.currentDateTime,
    currentView: input.currentView,
    timezone: input.timezone,
  });
}

export async function suggestTextDraft(input: {
  text: string;
  mode: TextDraftMode;
  currentDate: string;
  currentDateTime: string;
  currentView: 'day' | 'week' | 'month' | 'year';
  timezone: string;
}): Promise<TextDraftResponse> {
  return post<TextDraftResponse>('/ai/text-draft', input);
}

export async function getAppleBirthdayMessage(birthdayId: number): Promise<AppleBirthdayMessage> {
  return get<AppleBirthdayMessage>(`/apple-birthdays/${birthdayId}/message`);
}

export async function patchAppleBirthdayMessage(
  birthdayId: number,
  messageText: string,
): Promise<AppleBirthdayMessage> {
  return patch<AppleBirthdayMessage>(`/apple-birthdays/${birthdayId}/message`, { messageText });
}

export async function searchWatchTitles(query: string): Promise<WatchSearchResult[]> {
  return post<WatchSearchResult[]>('/media/watch/search', { query });
}

export async function getWatchStreamingSources(
  watchmodeId: number,
  region = 'US',
): Promise<string[]> {
  const response = await get<{ providers: Array<{ name: string }> }>(
    `/media/watch/${watchmodeId}/sources?region=${encodeURIComponent(region)}`,
  );
  return Array.isArray(response.providers) ? response.providers.map((provider) => provider.name) : [];
}

// ─── Project mutations ──────────────────────────────────────────────────────

export async function createProject(project: Project): Promise<{ id: number }> {
  return post<{ id: number }>('/projects', {
    client_id: project.id,
    goal_id:   project.goalId ?? null,
    tag_id:    null,
    title:     project.title,
    color:     null,
    start_date: project.startDate ?? null,
    end_date:   project.endDate ?? null,
  });
}

export async function patchProject(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/projects/${backendId}`, fields);
}

export async function deleteProject(backendId: number): Promise<void> {
  await del(`/projects/${backendId}`);
}

// ─── RecurrentTask mutations ────────────────────────────────────────────────

export async function createRecurrentTask(rt: RecurrentTask, tags: Tag[]): Promise<{ id: number }> {
  return post<{ id: number }>('/recurrent-tasks', {
    client_id:              rt.id,
    tag_id:                 resolveTagBackendId(rt.tagId, tags),
    title:                  rt.title,
    notes:                  rt.notes ?? null,
    recurrence_rule:        frequencyToRule(rt.frequency),
    anchor_date:            rt.anchorDate,
    completed_through_date: rt.completedThroughDate ?? null,
    location:               'backlog',
    is_active:              true,
  });
}

export async function patchRecurrentTask(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/recurrent-tasks/${backendId}`, fields);
}

export async function deleteRecurrentTask(backendId: number): Promise<void> {
  await del(`/recurrent-tasks/${backendId}`);
}

export async function createGoogleTimedEvent(input: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  tz: string;
  endDate?: string;
}): Promise<CalendarEntry> {
  return post<CalendarEntry>('/google/events', {
    title: input.title,
    date: input.date,
    end_date: input.endDate ?? null,
    start_time: toApiTime(input.startTime),
    end_time: toApiTime(input.endTime),
    notes: input.notes ?? null,
    tz: input.tz,
  });
}

export async function patchGoogleTimedEvent(eventId: string, input: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  tz: string;
  endDate?: string;
}): Promise<CalendarEntry> {
  return patch<CalendarEntry>(`/google/events/${eventId}`, {
    title: input.title,
    date: input.date,
    end_date: input.endDate ?? null,
    start_time: toApiTime(input.startTime),
    end_time: toApiTime(input.endTime),
    notes: input.notes ?? null,
    tz: input.tz,
  });
}

export async function deleteGoogleTimedEvent(eventId: string): Promise<void> {
  await del(`/google/events/${eventId}`);
}

export async function createGoogleAllDayEvent(input: {
  title: string;
  date: string;
  endDate?: string;
  notes?: string;
}): Promise<AllDayEvent> {
  return post<AllDayEvent>('/google/all-day-events', {
    title: input.title,
    date: input.date,
    end_date: input.endDate ?? null,
    notes: input.notes ?? null,
  });
}

export async function patchGoogleAllDayEvent(eventId: string, input: {
  title: string;
  date: string;
  endDate?: string;
  notes?: string;
}): Promise<AllDayEvent> {
  return patch<AllDayEvent>(`/google/all-day-events/${eventId}`, {
    title: input.title,
    date: input.date,
    end_date: input.endDate ?? null,
    notes: input.notes ?? null,
  });
}

export async function deleteGoogleAllDayEvent(eventId: string): Promise<void> {
  await del(`/google/all-day-events/${eventId}`);
}

// ─── Tag mutations ──────────────────────────────────────────────────────────

export async function createTag(tag: Tag): Promise<{ id: number }> {
  return post<{ id: number }>('/tags', {
    client_id:  tag.id,
    name:       tag.name,
    color:      tag.color,
    color_dark: tag.colorDark,
  });
}

export async function patchTag(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/tags/${backendId}`, fields);
}

export async function deleteTag(backendId: number): Promise<void> {
  await del(`/tags/${backendId}`);
}
