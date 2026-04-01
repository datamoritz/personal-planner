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

import { addDays, format, startOfMonth, addMonths } from 'date-fns';
import type {
  Task,
  Project,
  RecurrentTask,
  RecurrenceFrequency,
  CalendarEntry,
  Tag,
} from '@/types';

export const API_BASE = 'https://planner-api.moritzknodler.com';

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
    case 'custom':  return `custom:${freq.intervalDays}`;
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

  if (rule.startsWith('custom:')) {
    const intervalDays = parseInt(rule.split(':')[1], 10);
    if (!isNaN(intervalDays)) return { type: 'custom', intervalDays };
  }

  // Unknown rule: fall back to daily
  return { type: 'daily' };
}

/** Compute the next occurrence date for a recurrence rule, relative to today. */
export function computeNextDueDate(freq: RecurrenceFrequency): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (freq.type) {
    case 'daily':
      return format(today, 'yyyy-MM-dd');

    case 'weekly': {
      const todayNum = today.getDay(); // 0=Sun
      const daysUntil = (freq.dayOfWeek - todayNum + 7) % 7;
      return format(addDays(today, daysUntil), 'yyyy-MM-dd');
    }

    case 'monthly': {
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), freq.dayOfMonth);
      if (thisMonth >= today) return format(thisMonth, 'yyyy-MM-dd');
      return format(addMonths(startOfMonth(today), 1).setDate(freq.dayOfMonth), 'yyyy-MM-dd');
    }

    case 'custom':
      return format(today, 'yyyy-MM-dd');
  }
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
  return t.length === 5 ? `${t}:00` : t;
}

// ─── Backend → frontend converters ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendTask             = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendProject          = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendRecurrentTask    = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCalendarEntry    = any;
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
    title:            b.title,
    status:           b.status,
    location:         b.location,
    date:             b.task_date ?? undefined,
    startTime:        fromApiTime(b.start_time),
    endTime:          fromApiTime(b.end_time),
    projectId:        b.project_id != null ? projectIdMap.get(b.project_id) : undefined,
    recurrentTaskId:  b.recurrent_task_id != null ? recurrentTaskIdMap.get(b.recurrent_task_id) : undefined,
    tagId:            b.tag_id != null ? tagIdMap.get(b.tag_id) : undefined,
    notes:            b.notes ?? undefined,
    createdAt:        b.created_at,
    updatedAt:        b.updated_at,
  };
}

function toProject(b: BackendProject, tagIdMap: Map<number, string>): Project {
  return {
    id:          b.client_id ?? String(b.id),
    backendId:   b.id,
    title:       b.title,
    subtaskIds:  [],  // derived from tasks after full fetch
    status:      b.is_finished ? 'finished' : 'active',
    tagId:       b.tag_id != null ? tagIdMap.get(b.tag_id) : undefined,
    createdAt:   b.created_at,
    updatedAt:   b.updated_at,
  };
}

function toRecurrentTask(b: BackendRecurrentTask): RecurrentTask {
  const frequency = ruleToFrequency(b.recurrence_rule);
  return {
    id:          b.client_id ?? String(b.id),
    backendId:   b.id,
    title:       b.title,
    frequency,
    nextDueDate: computeNextDueDate(frequency),
    notes:       b.notes ?? undefined,
    createdAt:   b.created_at,
    updatedAt:   b.updated_at,
  };
}

function toCalendarEntry(b: BackendCalendarEntry): CalendarEntry {
  return {
    id:        b.client_id ?? String(b.id),
    backendId: b.id,
    title:     b.title,
    date:      b.entry_date,
    startTime: fromApiTime(b.start_time)!,
    endTime:   fromApiTime(b.end_time)!,
    notes:     b.notes ?? undefined,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
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
  calendarEntries: CalendarEntry[];
  tags:            Tag[];
}

export async function fetchAll(): Promise<BootData> {
  const [
    backendProjects,
    backendTags,
    backendRecurrentTasks,
    backendCalendarEntries,
    backendTasks,
  ] = await Promise.all([
    get<BackendProject[]>('/projects'),
    get<BackendTag[]>('/tags'),
    get<BackendRecurrentTask[]>('/recurrent-tasks'),
    get<BackendCalendarEntry[]>('/calendar-entries'),
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
  const recurrentTasks  = backendRecurrentTasks.map(toRecurrentTask);
  const calendarEntries = backendCalendarEntries.map(toCalendarEntry);
  const tasks           = backendTasks.map((t) => toTask(t, projectIdMap, recurrentTaskIdMap, tagIdMap));

  return { projects, tags, recurrentTasks, calendarEntries, tasks };
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
    project_id:          resolveProjectBackendId(task.projectId, projects),
    recurrent_task_id:   resolveRecurrentTaskBackendId(task.recurrentTaskId, recurrentTasks),
    tag_id:              resolveTagBackendId(task.tagId, tags),
    sort_order:          0,
  };

  return post<{ id: number }>('/tasks', payload);
}

export async function patchTask(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/tasks/${backendId}`, fields);
}

export async function deleteTask(backendId: number): Promise<void> {
  await del(`/tasks/${backendId}`);
}

// ─── Project mutations ──────────────────────────────────────────────────────

export async function createProject(project: Project): Promise<{ id: number }> {
  return post<{ id: number }>('/projects', {
    client_id: project.id,
    tag_id:    null,
    title:     project.title,
    color:     null,
  });
}

export async function patchProject(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/projects/${backendId}`, fields);
}

export async function deleteProject(backendId: number): Promise<void> {
  await del(`/projects/${backendId}`);
}

// ─── RecurrentTask mutations ────────────────────────────────────────────────

export async function createRecurrentTask(rt: RecurrentTask): Promise<{ id: number }> {
  return post<{ id: number }>('/recurrent-tasks', {
    client_id:       rt.id,
    title:           rt.title,
    notes:           rt.notes ?? null,
    recurrence_rule: frequencyToRule(rt.frequency),
    location:        'backlog',
    is_active:       true,
  });
}

export async function patchRecurrentTask(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/recurrent-tasks/${backendId}`, fields);
}

export async function deleteRecurrentTask(backendId: number): Promise<void> {
  await del(`/recurrent-tasks/${backendId}`);
}

// ─── CalendarEntry mutations ────────────────────────────────────────────────

export async function createCalendarEntry(entry: CalendarEntry): Promise<{ id: number }> {
  return post<{ id: number }>('/calendar-entries', {
    client_id:  entry.id,
    title:      entry.title,
    notes:      entry.notes ?? null,
    entry_date: entry.date,
    start_time: toApiTime(entry.startTime),
    end_time:   toApiTime(entry.endTime),
  });
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

export async function patchCalendarEntry(backendId: number, fields: Record<string, unknown>): Promise<void> {
  await patch<unknown>(`/calendar-entries/${backendId}`, fields);
}

export async function deleteCalendarEntry(backendId: number): Promise<void> {
  await del(`/calendar-entries/${backendId}`);
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

// ─── One-time localStorage import ───────────────────────────────────────────

/** Shape of the old Zustand planner-v1 localStorage state (pre-Phase 2). */
export interface LegacyPlannerData {
  tasks?: Array<{
    id: string; title: string; status: string; location: string;
    date?: string; startTime?: string; endTime?: string;
    projectId?: string; recurrentTaskId?: string;
    notes?: string; createdAt?: string; updatedAt?: string;
  }>;
  projects?: Array<{
    id: string; title: string; status?: string;
    createdAt?: string; updatedAt?: string;
  }>;
  recurrentTasks?: Array<{
    id: string; title: string; frequency: RecurrenceFrequency;
    notes?: string; createdAt?: string; updatedAt?: string;
  }>;
  calendarEntries?: Array<{
    id: string; title: string; date: string;
    startTime: string; endTime: string;
    notes?: string; createdAt?: string; updatedAt?: string;
  }>;
  tags?: Array<{
    id: string; name: string; color: string;
    createdAt?: string; updatedAt?: string;
  }>;
}

export interface ImportResult {
  inserted_tags:             number;
  inserted_projects:         number;
  inserted_recurrent_tasks:  number;
  inserted_calendar_entries: number;
  inserted_tasks:            number;
}

/** Transform legacy localStorage data and POST it to /import. */
export async function importPlanner(legacy: LegacyPlannerData): Promise<ImportResult> {
  return post<ImportResult>('/import', {
    tags: (legacy.tags ?? []).map((t) => ({
      client_id:  t.id,
      name:       t.name,
      color:      t.color,
      created_at: t.createdAt ?? null,
      updated_at: t.updatedAt ?? null,
    })),
    projects: (legacy.projects ?? []).map((p) => ({
      client_id:   p.id,
      title:       p.title,
      is_finished: p.status === 'finished',
      created_at:  p.createdAt ?? null,
      updated_at:  p.updatedAt ?? null,
    })),
    recurrent_tasks: (legacy.recurrentTasks ?? []).map((r) => ({
      client_id:       r.id,
      title:           r.title,
      recurrence_rule: frequencyToRule(r.frequency),
      notes:           r.notes ?? null,
      created_at:      r.createdAt ?? null,
      updated_at:      r.updatedAt ?? null,
    })),
    calendar_entries: (legacy.calendarEntries ?? []).map((e) => ({
      client_id:  e.id,
      title:      e.title,
      entry_date: e.date,
      start_time: toApiTime(e.startTime),
      end_time:   toApiTime(e.endTime),
      notes:      e.notes ?? null,
      created_at: e.createdAt ?? null,
      updated_at: e.updatedAt ?? null,
    })),
    tasks: (legacy.tasks ?? []).map((t) => ({
      client_id:                t.id,
      title:                    t.title,
      status:                   t.status,
      location:                 t.location,
      task_date:                t.date ?? null,
      start_time:               toApiTime(t.startTime),
      end_time:                 toApiTime(t.endTime),
      project_client_id:        t.projectId ?? null,
      recurrent_task_client_id: t.recurrentTaskId ?? null,
      notes:                    t.notes ?? null,
      created_at:               t.createdAt ?? null,
      updated_at:               t.updatedAt ?? null,
    })),
  });
}
