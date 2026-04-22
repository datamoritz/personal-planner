'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addDays, addMonths, endOfYear, format, subDays, subMonths } from 'date-fns';
import * as api from '@/lib/api';
import { minutesToTime, timeToMinutes } from '@/lib/timeGrid';
import type {
  Task,
  CalendarEntry,
  AllDayEvent,
  RecurrentTask,
  RecurrenceFrequency,
  Project,
  Tag,
  MediaItem,
  MediaKind,
  MediaStatus,
  PlannerState,
  PlannerViewMode,
  MonthViewMode,
  MonthTaskLayout,
} from '@/types';
import type { BootData } from '@/lib/api';

// ─── Helpers ───────────────────────────────────────────────────────────────

const today = format(new Date(), 'yyyy-MM-dd');

function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function inferMediaKindFromTitle(title: string): MediaKind | null {
  const normalized = title.trim().toLowerCase();
  if (/^read(?:\s|:|-)/i.test(normalized) || normalized === 'read') return 'read';
  if (/^watch(?:\s|:|-)/i.test(normalized) || normalized === 'watch') return 'watch';
  return null;
}

function normalizeMediaTitle(title: string, kind?: MediaKind): string {
  const trimmed = title.trim();
  if (!kind) return trimmed;
  const pattern = kind === 'read'
    ? /^read(?:\s*[:\-]\s*|\s+)/i
    : /^watch(?:\s*[:\-]\s*|\s+)/i;
  return trimmed.replace(pattern, '').trim() || trimmed;
}

function sortMediaItems(items: MediaItem[]): MediaItem[] {
  const statusRank: Record<MediaStatus, number> = {
    in_progress: 0,
    queued: 1,
    finished: 2,
  };
  return [...items].sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff !== 0) return statusDiff;
    const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.dateAdded.localeCompare(b.dateAdded);
  });
}

function nextMediaSortOrder(items: MediaItem[], kind: MediaKind): number {
  return items.filter((item) => item.kind === kind).length;
}

function taskBucketKey(task: Pick<Task, 'location' | 'date' | 'projectId'>): string {
  switch (task.location) {
    case 'project':
      return `project:${task.projectId ?? ''}`;
    case 'myday':
      return `myday:${task.date ?? ''}`;
    case 'today':
      return `today:${task.date ?? ''}`;
    case 'upcoming':
      return `upcoming:${task.date ?? ''}`;
    case 'backlog':
    default:
      return 'backlog';
  }
}

function sortBySortOrder<T extends { sortOrder?: number; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

function assignSequentialSortOrders<T extends Task | Project>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, sortOrder: index }));
}

function nextTaskSortOrder(tasks: Task[], bucket: Pick<Task, 'location' | 'date' | 'projectId'>): number {
  return tasks.filter((task) => taskBucketKey(task) === taskBucketKey(bucket)).length;
}

function parseIsoDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function getRecurrentCycleDueDate(task: RecurrentTask, referenceDate: string): string {
  return api.getCurrentRecurrentCycleDueDate(task.frequency, task.anchorDate, referenceDate);
}

function isRecurrentTaskCompleted(task: RecurrentTask, referenceDate: string = today): boolean {
  return api.isRecurrentCycleComplete(
    task.frequency,
    task.anchorDate,
    task.completedThroughDate,
    referenceDate,
  );
}

function deriveNextDueDate(task: RecurrentTask): string {
  return api.computeNextDueDate(task.frequency, task.anchorDate, task.completedThroughDate);
}

function enumerateRecurringDates(
  frequency: RecurrenceFrequency,
  startDate: string,
  endDate: string,
  anchorDate?: string,
): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const dates: string[] = [];

  switch (frequency.type) {
    case 'daily': {
      for (let current = start; current <= end; current = addDays(current, 1)) {
        dates.push(format(current, 'yyyy-MM-dd'));
      }
      return dates;
    }

    case 'weekly': {
      const offset = (frequency.dayOfWeek - start.getDay() + 7) % 7;
      for (let current = addDays(start, offset); current <= end; current = addDays(current, 7)) {
        dates.push(format(current, 'yyyy-MM-dd'));
      }
      return dates;
    }

    case 'monthly': {
      for (let monthStart = new Date(start.getFullYear(), start.getMonth(), 1); monthStart <= end; monthStart = addMonths(monthStart, 1)) {
        const candidate = new Date(monthStart.getFullYear(), monthStart.getMonth(), frequency.dayOfMonth);
        if (candidate.getMonth() !== monthStart.getMonth()) continue;
        if (candidate < start || candidate > end) continue;
        dates.push(format(candidate, 'yyyy-MM-dd'));
      }
      return dates;
    }

    case 'custom-days': {
      const interval = Math.max(1, frequency.intervalDays);
      let current = parseIsoDate(anchorDate ?? startDate);
      while (current < start) current = addDays(current, interval);
      for (; current <= end; current = addDays(current, interval)) {
        dates.push(format(current, 'yyyy-MM-dd'));
      }
      return dates;
    }

    case 'custom-weeks': {
      const intervalWeeks = Math.max(1, frequency.intervalWeeks);
      let current = parseIsoDate(anchorDate ?? startDate);
      const targetDay = frequency.dayOfWeek;
      const firstOffset = (targetDay - current.getDay() + 7) % 7;
      current = addDays(current, firstOffset);
      while (current < start) current = addDays(current, intervalWeeks * 7);
      for (; current <= end; current = addDays(current, intervalWeeks * 7)) {
        dates.push(format(current, 'yyyy-MM-dd'));
      }
      return dates;
    }

    case 'custom-months': {
      const intervalMonths = Math.max(1, frequency.intervalMonths);
      let cursor = parseIsoDate(anchorDate ?? startDate);
      if (cursor.getDate() !== frequency.dayOfMonth) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), frequency.dayOfMonth);
      }
      while (cursor < start) cursor = addMonths(cursor, intervalMonths);
      for (; cursor <= end; cursor = addMonths(cursor, intervalMonths)) {
        const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), frequency.dayOfMonth);
        if (candidate.getMonth() !== cursor.getMonth()) continue;
        if (candidate < start || candidate > end) continue;
        dates.push(format(candidate, 'yyyy-MM-dd'));
      }
      return dates;
    }
  }
}

const DISPLAY_TAG_COLORS_BY_NAME: Record<string, Pick<Tag, 'color' | 'colorDark'>> = {
  Finances: { color: '#d8f2f8', colorDark: '#0891b2' },
  Home:     { color: '#fef3c7', colorDark: '#d97706' },
  Study:    { color: '#e8defa', colorDark: '#7c3aed' },
  Work:     { color: '#dbeafe', colorDark: '#2563eb' },
};

function normalizeDisplayTag(tag: Tag): Tag {
  const mapped = DISPLAY_TAG_COLORS_BY_NAME[tag.name];
  return mapped ? { ...tag, ...mapped } : tag;
}

type PendingGoogleMutation =
  | { type: 'upsert'; entry: CalendarEntry }
  | { type: 'delete' };

type PendingAllDayMutation =
  | { type: 'upsert'; event: AllDayEvent }
  | { type: 'delete' };

function googleBaseId(id: string): string {
  return id.split('::')[0];
}

function googleEntryStartKey(entry: CalendarEntry): string {
  return `${entry.startDate ?? entry.date}T${entry.startTime}`;
}

function mergeGoogleEntryGroup(entries: CalendarEntry[]): CalendarEntry {
  const sorted = [...entries].sort((a, b) =>
    googleEntryStartKey(a).localeCompare(googleEntryStartKey(b))
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return {
    ...first,
    id: googleBaseId(first.id),
    date: first.startDate ?? first.date,
    startDate: first.startDate ?? first.date,
    endDate: last.endDate ?? last.date,
    endTime: last.endTime,
  };
}

function sameGoogleEventShape(a: CalendarEntry, b: CalendarEntry): boolean {
  return (
    a.title === b.title &&
    (a.startDate ?? a.date) === (b.startDate ?? b.date) &&
    (a.endDate ?? a.date) === (b.endDate ?? b.date) &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    (a.notes ?? '') === (b.notes ?? '')
  );
}

function sameAllDayEventShape(a: AllDayEvent, b: AllDayEvent): boolean {
  return (
    a.title === b.title &&
    a.date === b.date &&
    (a.endDate ?? a.date) === (b.endDate ?? b.date) &&
    (a.notes ?? '') === (b.notes ?? '')
  );
}

function reconcileFetchedAllDayEvents(
  incoming: AllDayEvent[],
  pending: Record<string, PendingAllDayMutation>,
): {
  events: AllDayEvent[];
  pending: Record<string, PendingAllDayMutation>;
} {
  let nextEvents = [...incoming];
  const nextPending = { ...pending };

  for (const [eventId, mutation] of Object.entries(pending)) {
    const incomingEvent = incoming.find((event) => event.id === eventId);

    if (mutation.type === 'delete') {
      nextEvents = nextEvents.filter((event) => event.id !== eventId);
      if (!incomingEvent) delete nextPending[eventId];
      continue;
    }

    if (incomingEvent && sameAllDayEventShape(incomingEvent, mutation.event)) {
      delete nextPending[eventId];
      continue;
    }

    nextEvents = nextEvents.filter((event) => event.id !== eventId);
    nextEvents.push(mutation.event);
  }

  return { events: nextEvents, pending: nextPending };
}

function reconcileFetchedGoogleEntries(
  incoming: CalendarEntry[],
  pending: Record<string, PendingGoogleMutation>,
): {
  entries: CalendarEntry[];
  pending: Record<string, PendingGoogleMutation>;
} {
  let nextEntries = [...incoming];
  const nextPending = { ...pending };

  for (const [baseId, mutation] of Object.entries(pending)) {
    const incomingGroup = incoming.filter((entry) => googleBaseId(entry.id) === baseId);

    if (mutation.type === 'delete') {
      nextEntries = nextEntries.filter((entry) => googleBaseId(entry.id) !== baseId);
      if (incomingGroup.length === 0) {
        delete nextPending[baseId];
      }
      continue;
    }

    if (incomingGroup.length > 0) {
      const mergedIncoming = mergeGoogleEntryGroup(incomingGroup);
      if (sameGoogleEventShape(mergedIncoming, mutation.entry)) {
        delete nextPending[baseId];
        continue;
      }
    }

    nextEntries = nextEntries.filter((entry) => googleBaseId(entry.id) !== baseId);
    nextEntries.push(mutation.entry);
  }

  return { entries: nextEntries, pending: nextPending };
}

// ─── Store interface ────────────────────────────────────────────────────────

interface PlannerStore extends PlannerState {
  theme: 'dark' | 'light';
  viewMode: PlannerViewMode;
  monthViewMode: MonthViewMode;
  monthTaskLayout: MonthTaskLayout;
  yearPreviewEnabled: boolean;
  uncertaintyNotes: string;
  expandedProjectIds: string[];
  mediaItems: MediaItem[];
  setUncertaintyNotes: (text: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  selectedProjectIdForNotes: string | null;
  setSelectedProjectIdForNotes: (id: string | null) => void;
  toggleTheme: () => void;
  setCurrentDate: (date: string) => void;
  navigateDay: (direction: 'prev' | 'next') => void;
  navigateWeek: (direction: 'prev' | 'next') => void;
  navigateMonth: (direction: 'prev' | 'next') => void;
  navigateYear: (direction: 'prev' | 'next') => void;
  setViewMode: (mode: PlannerViewMode) => void;
  setMonthViewMode: (mode: MonthViewMode) => void;
  setMonthTaskLayout: (mode: MonthTaskLayout) => void;
  setYearPreviewEnabled: (enabled: boolean) => void;
  /** Hydrate the store with data fetched from the backend on boot. */
  hydrateFromBackend: (data: BootData) => void;
  // Tasks
  toggleTask: (id: string) => void;
  addTask: (data: { title: string; location: Task['location']; date?: string; projectId?: string }) => string;
  updateTask: (id: string, updates: Partial<Pick<Task, 'title' | 'notes' | 'date' | 'startTime' | 'endTime' | 'estimateHours'>>) => void;
  deleteTask: (id: string) => void;
  // Read / Watch
  addMediaItem: (data: { title: string; kind: MediaKind; recommendedBy?: string; status?: MediaStatus }) => string;
  updateMediaItem: (
    id: string,
    updates: Partial<Pick<MediaItem, 'title' | 'recommendedBy' | 'status' | 'watchmodeId' | 'streamingOn' | 'streamingCheckedAt'>>,
  ) => void;
  deleteMediaItem: (id: string) => void;
  reorderMediaItems: (kind: MediaKind, activeId: string, overId: string) => void;
  convertTaskToMedia: (taskId: string, kind: MediaKind) => boolean;
  // Recurrent tasks
  addRecurrentTask: (data: { title: string; frequency: RecurrenceFrequency }) => void;
  updateRecurrentTask: (id: string, updates: Partial<Pick<RecurrentTask, 'title' | 'notes' | 'frequency'>>) => void;
  deleteRecurrentTask: (id: string) => void;
  advanceRecurrentTask: (id: string) => void;
  spawnRecurrentTasksForNextMonths: (id: string, months?: number) => void;
  setRecurrentTaskTag: (id: string, tagId: string | undefined) => void;
  // Projects
  addProject: (title: string) => void;
  deleteProject: (id: string) => void;
  finishProject: (id: string) => void;
  reorderProject: (activeId: string, overId: string) => void;
  setProjectTag: (projectId: string, tagId: string | undefined) => void;
  // Tags
  addTag: (data: { name: string; color: string; colorDark: string }) => void;
  updateTag: (id: string, data: { name?: string; color?: string; colorDark?: string }) => void;
  deleteTag: (id: string) => void;
  setTaskTag: (taskId: string, tagId: string | undefined) => void;
  // Filter
  activeTagFilter: string | null;
  setActiveTagFilter: (id: string | null) => void;
  // Google Calendar (fetched at runtime, never persisted)
  googleCalendarEntries: CalendarEntry[];
  pendingGoogleMutations: Record<string, PendingGoogleMutation>;
  pendingGoogleAllDayMutations: Record<string, PendingAllDayMutation>;
  setGoogleCalendarEntries: (entries: CalendarEntry[]) => void;
  reconcileGoogleCalendarEntries: (entries: CalendarEntry[]) => void;
  applyOptimisticGoogleEntry: (entry: CalendarEntry) => void;
  applyOptimisticGoogleDelete: (entryId: string) => void;
  clearPendingGoogleMutation: (entryId: string) => void;
  googleAllDayEvents: AllDayEvent[];
  setGoogleAllDayEvents: (events: AllDayEvent[]) => void;
  reconcileGoogleAllDayEvents: (events: AllDayEvent[]) => void;
  applyOptimisticGoogleAllDayEvent: (event: AllDayEvent) => void;
  applyOptimisticGoogleAllDayDelete: (eventId: string) => void;
  clearPendingGoogleAllDayMutation: (eventId: string) => void;
  googleNeedsReconnect: boolean;
  setGoogleNeedsReconnect: (v: boolean) => void;
  // DnD
  reorderTask: (activeId: string, overId: string) => void;
  moveTask: (taskId: string, dest: { location: Task['location']; date?: string; projectId?: string; startTime?: string; endTime?: string }) => void;
  spawnRecurrentInstance: (recId: string, dest: { location: Task['location']; date?: string }) => void;
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set, get) => ({
      currentDate:                today,
      theme:                      'light',
      viewMode:                   'day' as PlannerViewMode,
      monthViewMode:              'events' as MonthViewMode,
      monthTaskLayout:            'grid' as MonthTaskLayout,
      yearPreviewEnabled:         true,
      uncertaintyNotes:           '',
      expandedProjectIds:         [],
      mediaItems:                 [],
      selectedProjectIdForNotes:  null,
      activeTagFilter:            null,
      // Entities start empty — populated by usePlannerData on boot
      tasks:           [],
      recurrentTasks:  [],
      projects:        [],
      tags:            [],

      setUncertaintyNotes: (text) => set({ uncertaintyNotes: text }),
      toggleProjectExpanded: (projectId) =>
        set((s) => ({
          expandedProjectIds: s.expandedProjectIds.includes(projectId)
            ? s.expandedProjectIds.filter((id) => id !== projectId)
            : [...s.expandedProjectIds, projectId],
        })),
      setSelectedProjectIdForNotes: (id) => set({ selectedProjectIdForNotes: id }),

      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      setCurrentDate: (date) => set({ currentDate: date }),

      navigateDay: (direction) => {
        const { currentDate } = get();
        const current = new Date(currentDate + 'T00:00:00');
        const next = direction === 'next' ? addDays(current, 1) : subDays(current, 1);
        set({ currentDate: format(next, 'yyyy-MM-dd') });
      },

      navigateWeek: (direction) => {
        const { currentDate } = get();
        const current = new Date(currentDate + 'T00:00:00');
        const next = direction === 'next' ? addDays(current, 7) : subDays(current, 7);
        set({ currentDate: format(next, 'yyyy-MM-dd') });
      },

      navigateMonth: (direction) => {
        const { currentDate } = get();
        const current = new Date(currentDate + 'T00:00:00');
        const next = direction === 'next' ? addMonths(current, 1) : subMonths(current, 1);
        set({ currentDate: format(next, 'yyyy-MM-dd') });
      },

      navigateYear: (direction) => {
        const { currentDate } = get();
        const current = new Date(currentDate + 'T00:00:00');
        const next = direction === 'next' ? addMonths(current, 12) : subMonths(current, 12);
        set({ currentDate: format(next, 'yyyy-MM-dd') });
      },

      setViewMode: (mode) => set({ viewMode: mode }),
      setMonthViewMode: (mode) => set({ monthViewMode: mode }),
      setMonthTaskLayout: (mode) => set({ monthTaskLayout: mode }),
      setYearPreviewEnabled: (enabled) => set({ yearPreviewEnabled: enabled }),

      hydrateFromBackend: (data) => {
        // Derive subtaskIds from tasks (backend stores FK on task, not on project)
        const subtaskMap = new Map<string, string[]>();
        for (const task of data.tasks) {
          if (task.projectId) {
            const existing = subtaskMap.get(task.projectId) ?? [];
            existing.push(task.id);
            subtaskMap.set(task.projectId, existing);
          }
        }
        const projects = data.projects.map((p) => ({
          ...p,
          subtaskIds: subtaskMap.get(p.id) ?? [],
        }));
        set({
          tasks:           data.tasks,
          projects,
          recurrentTasks:  data.recurrentTasks,
          tags:            data.tags.map(normalizeDisplayTag),
        });
      },

      // ── Tasks ──────────────────────────────────────────────────────────

      toggleTask: (id) => {
        const prevTask = get().tasks.find((t) => t.id === id);
        if (!prevTask) return;
        const newStatus: Task['status'] = prevTask.status === 'done' ? 'pending' : 'done';
        const ts = now();
        const prevTasks = get().tasks;
        const prevRecurrentTasks = get().recurrentTasks;

        if (prevTask.recurrentTaskId) {
          const recurrentTask = prevRecurrentTasks.find((task) => task.id === prevTask.recurrentTaskId);
          if (!recurrentTask) return;

          const cycleReferenceDate = prevTask.date ?? today;
          const cycleDueDate = getRecurrentCycleDueDate(recurrentTask, cycleReferenceDate);
          const linkedTasks = prevTasks.filter(
            (task) =>
              task.recurrentTaskId === recurrentTask.id &&
              getRecurrentCycleDueDate(recurrentTask, task.date ?? cycleReferenceDate) === cycleDueDate,
          );

          const nextCompletedThroughDate = newStatus === 'done'
            ? cycleDueDate
            : recurrentTask.completedThroughDate === cycleDueDate
              ? api.getPreviousRecurrentCycleDueDate(
                  recurrentTask.frequency,
                  cycleDueDate,
                  recurrentTask.anchorDate,
                )
              : recurrentTask.completedThroughDate;

          const nextRecurrentTask: RecurrentTask = {
            ...recurrentTask,
            completedThroughDate: nextCompletedThroughDate,
            updatedAt: ts,
          };
          nextRecurrentTask.nextDueDate = deriveNextDueDate(nextRecurrentTask);

          set((s) => ({
            tasks: s.tasks.map((task) =>
              linkedTasks.some((linkedTask) => linkedTask.id === task.id)
                ? { ...task, status: newStatus, updatedAt: ts }
                : task
            ),
            recurrentTasks: s.recurrentTasks.map((task) =>
              task.id === recurrentTask.id ? nextRecurrentTask : task
            ),
          }));

          const patchTasks = linkedTasks
            .filter((task) => task.backendId)
            .map((task) => api.patchTask(task.backendId!, { status: newStatus }));
          const patchRecurrent = recurrentTask.backendId
            ? api.patchRecurrentTask(recurrentTask.backendId, {
                completed_through_date: nextCompletedThroughDate ?? null,
              })
            : Promise.resolve();

          Promise.all([...patchTasks, patchRecurrent]).catch((err) => {
            console.error('[toggleTask]', err);
            set({ tasks: prevTasks, recurrentTasks: prevRecurrentTasks });
          });
          return;
        }

        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status: newStatus, updatedAt: ts } : t
          ),
        }));

        if (prevTask.backendId) {
          api.patchTask(prevTask.backendId, { status: newStatus }).catch((err) => {
            console.error('[toggleTask]', err);
            set({ tasks: prevTasks });
          });
        }
      },

      addTask: (data) => {
        const ts = now();
        const projectTagId = data.projectId
          ? get().projects.find((p) => p.id === data.projectId)?.tagId
          : undefined;
        const newTask: Task = {
          id:        uid(),
          sortOrder: nextTaskSortOrder(get().tasks, {
            location: data.location,
            date: data.date,
            projectId: data.projectId,
          }),
          title:     data.title,
          status:    'pending',
          location:  data.location,
          date:      data.date,
          projectId: data.projectId,
          tagId:     projectTagId,
          createdAt: ts,
          updatedAt: ts,
        };

        set((s) => {
          const tasks = [...s.tasks, newTask];
          if (data.projectId) {
            const projects = s.projects.map((p) =>
              p.id === data.projectId
                ? { ...p, subtaskIds: [...p.subtaskIds, newTask.id], updatedAt: ts }
                : p
            );
            return { tasks, projects };
          }
          return { tasks };
        });

        const { projects, recurrentTasks, tags } = get();
        api.createTask(newTask, projects, recurrentTasks, tags)
          .then(({ id: backendId }) => {
            set((s) => ({
              tasks: s.tasks.map((t) => (t.id === newTask.id ? { ...t, backendId } : t)),
            }));
          })
          .catch((err) => {
            console.error('[addTask]', err);
            set((s) => ({
              tasks:    s.tasks.filter((t) => t.id !== newTask.id),
              projects: s.projects.map((p) =>
                p.id === data.projectId
                ? { ...p, subtaskIds: p.subtaskIds.filter((sid) => sid !== newTask.id) }
                : p
              ),
            }));
          });

        return newTask.id;
      },

      updateTask: (id, updates) => {
        const prevTask = get().tasks.find((t) => t.id === id);
        if (!prevTask) return;

        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task) return {};
          const clearingDate =
            'date' in updates &&
            updates.date === undefined &&
            task.date !== undefined &&
            (task.location === 'today' || task.location === 'upcoming');
          const merged = { ...task, ...updates, updatedAt: now() };
          if (clearingDate) {
            merged.location  = task.projectId ? 'project' : 'backlog';
            merged.date      = undefined;
            merged.startTime = undefined;
            merged.endTime   = undefined;
            const others = s.tasks.filter((t) => t.id !== id);
            return { tasks: [merged, ...others] };
          }
          return { tasks: s.tasks.map((t) => (t.id === id ? merged : t)) };
        });

        const updated = get().tasks.find((t) => t.id === id);
        if (updated?.backendId) {
          const apiFields: Record<string, unknown> = {};
          if ('title' in updates)     apiFields.title      = updates.title ?? null;
          if ('notes' in updates)     apiFields.notes      = updates.notes ?? null;
          if ('date' in updates)      apiFields.task_date  = updates.date ?? null;
          if ('startTime' in updates) apiFields.start_time = updates.startTime ? `${updates.startTime}:00` : null;
          if ('endTime' in updates)   apiFields.end_time   = updates.endTime   ? `${updates.endTime}:00`   : null;
          if ('estimateHours' in updates) apiFields.estimate_hours = updates.estimateHours ?? null;
          if (updated.location !== prevTask.location) apiFields.location = updated.location;

          api.patchTask(updated.backendId, apiFields).catch((err) => {
            console.error('[updateTask]', err);
            set((s) => ({
              tasks: s.tasks.map((t) => (t.id === id ? prevTask : t)),
            }));
          });
        }
      },

      deleteTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        set((s) => ({
          tasks:    s.tasks.filter((t) => t.id !== id),
          projects: s.projects.map((p) => ({
            ...p,
            subtaskIds: p.subtaskIds.filter((sid) => sid !== id),
            updatedAt:  now(),
          })),
        }));
        if (task?.backendId) {
          api.deleteTask(task.backendId).catch((err) => {
            console.error('[deleteTask]', err);
            if (task) {
              set((s) => ({ tasks: [...s.tasks, task] }));
            }
          });
        }
      },

      addMediaItem: (data) => {
        const item: MediaItem = {
          id: uid(),
          title: data.title.trim(),
          kind: data.kind,
          status: data.status ?? 'queued',
          recommendedBy: data.recommendedBy?.trim() || undefined,
          dateAdded: now(),
          finishedAt: data.status === 'finished' ? now() : undefined,
          sortOrder: nextMediaSortOrder(get().mediaItems, data.kind),
        };
        set((s) => ({ mediaItems: [...s.mediaItems, item] }));
        return item.id;
      },

      updateMediaItem: (id, updates) =>
        set((s) => ({
          mediaItems: s.mediaItems.map((item) => {
            if (item.id !== id) return item;
            const nextStatus = updates.status ?? item.status;
            const nextRecommendedBy = updates.recommendedBy === undefined
              ? item.recommendedBy
              : (updates.recommendedBy.trim().length ? updates.recommendedBy : undefined);
            return {
              ...item,
              ...updates,
              recommendedBy: nextRecommendedBy,
              finishedAt:
                nextStatus === 'finished'
                  ? item.finishedAt ?? now()
                  : undefined,
            };
          }),
        })),

      deleteMediaItem: (id) =>
        set((s) => ({ mediaItems: s.mediaItems.filter((item) => item.id !== id) })),

      reorderMediaItems: (kind, activeId, overId) =>
        set((s) => {
          const items = sortMediaItems(s.mediaItems.filter((item) => item.kind === kind));
          const from = items.findIndex((item) => item.id === activeId);
          const to = items.findIndex((item) => item.id === overId);
          if (from === -1 || to === -1) return {};
          const nextItems = [...items];
          nextItems.splice(to, 0, nextItems.splice(from, 1)[0]);
          const reordered = nextItems.map((item, index) => ({ ...item, sortOrder: index }));
          return {
            mediaItems: s.mediaItems.map((item) =>
              item.kind === kind
                ? reordered.find((next) => next.id === item.id) ?? item
                : item
            ),
          };
        }),

      convertTaskToMedia: (taskId, kind) => {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) return false;
        const normalizedTitle = normalizeMediaTitle(task.title, inferMediaKindFromTitle(task.title) ?? kind);
        get().addMediaItem({
          title: normalizedTitle,
          kind,
        });
        get().deleteTask(taskId);
        return true;
      },

      // ── Recurrent tasks ────────────────────────────────────────────────

      addRecurrentTask: (data) => {
        const ts = now();
        const rt: RecurrentTask = {
          id:                   uid(),
          title:                data.title,
          tagId:                undefined,
          frequency:            data.frequency,
          anchorDate:           today,
          completedThroughDate: undefined,
          nextDueDate:          api.computeNextDueDate(data.frequency, today),
          createdAt:            ts,
          updatedAt:            ts,
        };
        set((s) => ({ recurrentTasks: [...s.recurrentTasks, rt] }));

        api.createRecurrentTask(rt, get().tags)
          .then(({ id: backendId }) => {
            set((s) => ({
              recurrentTasks: s.recurrentTasks.map((r) =>
                r.id === rt.id ? { ...r, backendId } : r
              ),
            }));
          })
          .catch((err) => {
            console.error('[addRecurrentTask]', err);
            set((s) => ({
              recurrentTasks: s.recurrentTasks.filter((r) => r.id !== rt.id),
            }));
          });
      },

      updateRecurrentTask: (id, updates) => {
        const prevRt = get().recurrentTasks.find((r) => r.id === id);
        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((r) => {
            if (r.id !== id) return r;
            const updatedTask = { ...r, ...updates, updatedAt: now() };
            return {
              ...updatedTask,
              nextDueDate: deriveNextDueDate(updatedTask),
            };
          }),
        }));
        const updated = get().recurrentTasks.find((r) => r.id === id);
        if (updated?.backendId) {
          const apiFields: Record<string, unknown> = {};
          if ('title' in updates)     apiFields.title            = updates.title;
          if ('notes' in updates)     apiFields.notes            = updates.notes ?? null;
          if ('frequency' in updates && updates.frequency)
                                      apiFields.recurrence_rule  = api.frequencyToRule(updates.frequency);

          api.patchRecurrentTask(updated.backendId, apiFields).catch((err) => {
            console.error('[updateRecurrentTask]', err);
            if (prevRt) {
              set((s) => ({
                recurrentTasks: s.recurrentTasks.map((r) => (r.id === id ? prevRt : r)),
              }));
            }
          });
        }
      },

      deleteRecurrentTask: (id) => {
        const rt            = get().recurrentTasks.find((r) => r.id === id);
        const spawnedTasks  = get().tasks.filter((t) => t.recurrentTaskId === id);
        set((s) => ({
          recurrentTasks: s.recurrentTasks.filter((r) => r.id !== id),
          tasks:          s.tasks.filter((t) => t.recurrentTaskId !== id),
        }));
        if (rt?.backendId) {
          // Delete spawned tasks from backend (backend uses SET NULL, not CASCADE).
          // Rollback both on any failure.
          const spawnedDeletes = spawnedTasks
            .filter((t) => t.backendId)
            .map((t) => api.deleteTask(t.backendId!));
          Promise.all([...spawnedDeletes, api.deleteRecurrentTask(rt.backendId)])
            .catch((err) => {
              console.error('[deleteRecurrentTask]', err);
              set((s) => ({
                recurrentTasks: [...s.recurrentTasks, rt],
                tasks:          [...s.tasks, ...spawnedTasks],
              }));
            });
        }
      },

      advanceRecurrentTask: (id) => {
        const prevRecurrentTasks = get().recurrentTasks;
        const prevTasks = get().tasks;
        const recurrentTask = prevRecurrentTasks.find((task) => task.id === id);
        if (!recurrentTask) return;

        const cycleDueDate = getRecurrentCycleDueDate(recurrentTask, today);
        const currentlyCompleted = isRecurrentTaskCompleted(recurrentTask, today);
        const nextStatus: Task['status'] = currentlyCompleted ? 'pending' : 'done';
        const nextCompletedThroughDate = currentlyCompleted
          ? api.getPreviousRecurrentCycleDueDate(
              recurrentTask.frequency,
              cycleDueDate,
              recurrentTask.anchorDate,
            )
          : cycleDueDate;
        const ts = now();

        const linkedTasks = prevTasks.filter(
          (task) =>
            task.recurrentTaskId === recurrentTask.id &&
            task.date &&
            getRecurrentCycleDueDate(recurrentTask, task.date) === cycleDueDate,
        );

        const nextRecurrentTask: RecurrentTask = {
          ...recurrentTask,
          completedThroughDate: nextCompletedThroughDate,
          updatedAt: ts,
        };
        nextRecurrentTask.nextDueDate = deriveNextDueDate(nextRecurrentTask);

        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((task) =>
            task.id === recurrentTask.id ? nextRecurrentTask : task
          ),
          tasks: s.tasks.map((task) =>
            linkedTasks.some((linkedTask) => linkedTask.id === task.id)
              ? { ...task, status: nextStatus, updatedAt: ts }
              : task
          ),
        }));

        const patchTasks = linkedTasks
          .filter((task) => task.backendId)
          .map((task) => api.patchTask(task.backendId!, { status: nextStatus }));
        const patchRecurrent = recurrentTask.backendId
          ? api.patchRecurrentTask(recurrentTask.backendId, {
              completed_through_date: nextCompletedThroughDate ?? null,
            })
          : Promise.resolve();

        Promise.all([...patchTasks, patchRecurrent]).catch((err) => {
          console.error('[advanceRecurrentTask]', err);
          set({ recurrentTasks: prevRecurrentTasks, tasks: prevTasks });
        });
      },

      spawnRecurrentTasksForNextMonths: (id) => {
        const rt = get().recurrentTasks.find((r) => r.id === id);
        if (!rt) return;

        const startDate = today;
        const endDate = format(endOfYear(parseIsoDate(today)), 'yyyy-MM-dd');
        const candidateDates = enumerateRecurringDates(rt.frequency, startDate, endDate, rt.nextDueDate);
        const existingDates = new Set(
          get().tasks
            .filter((t) => t.recurrentTaskId === id && t.date)
            .map((t) => t.date as string)
        );
        const datesToCreate = candidateDates.filter((date) => !existingDates.has(date));
        if (datesToCreate.length === 0) return;

        const ts = now();
        const newTasks: Task[] = datesToCreate.map((date) => ({
          id: uid(),
          sortOrder: nextTaskSortOrder(get().tasks, { location: 'today', date }),
          title: rt.title,
          status: api.isRecurrentCycleComplete(rt.frequency, rt.anchorDate, rt.completedThroughDate, date)
            ? 'done'
            : 'pending',
          location: 'today',
          date,
          recurrentTaskId: id,
          tagId: rt.tagId,
          notes: rt.notes,
          createdAt: ts,
          updatedAt: ts,
        }));

        set((s) => ({ tasks: [...s.tasks, ...newTasks] }));

        const { projects, recurrentTasks, tags } = get();
        api.createTasksBulk(newTasks, projects, recurrentTasks, tags)
          .then(({ created }) => {
            const backendIdByClientId = new Map(
              created
                .filter((task) => task.client_id)
                .map((task) => [String(task.client_id), task.id])
            );
            set((s) => ({
              tasks: s.tasks.map((task) =>
                backendIdByClientId.has(task.id)
                  ? { ...task, backendId: backendIdByClientId.get(task.id) }
                  : task
              ),
            }));
          })
          .catch((err) => {
            console.error('[spawnRecurrentTasksForNextMonths]', err);
            set((s) => ({
              tasks: s.tasks.filter((task) => !newTasks.some((createdTask) => createdTask.id === task.id)),
            }));
          });
      },

      // ── Projects ───────────────────────────────────────────────────────

      addProject: (title) => {
        const ts = now();
        const project: Project = {
          id:          uid(),
          sortOrder:   get().projects.length,
          title,
          subtaskIds:  [],
          status:      'active',
          createdAt:   ts,
          updatedAt:   ts,
        };
        set((s) => ({ projects: [...s.projects, project] }));

        api.createProject(project)
          .then(({ id: backendId }) => {
            set((s) => ({
              projects: s.projects.map((p) =>
                p.id === project.id ? { ...p, backendId } : p
              ),
            }));
          })
          .catch((err) => {
            console.error('[addProject]', err);
            set((s) => ({
              projects: s.projects.filter((p) => p.id !== project.id),
            }));
          });
      },

      deleteProject: (id) => {
        const project  = get().projects.find((p) => p.id === id);
        const subtasks = get().tasks.filter((t) => t.projectId === id);
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          tasks:    s.tasks.filter((t) => t.projectId !== id),
        }));
        if (project?.backendId) {
          // Delete subtasks from backend first (backend uses SET NULL, not CASCADE),
          // then delete the project. Rollback both on any failure.
          const subtaskDeletes = subtasks
            .filter((t) => t.backendId)
            .map((t) => api.deleteTask(t.backendId!));
          Promise.all([...subtaskDeletes, api.deleteProject(project.backendId)])
            .catch((err) => {
              console.error('[deleteProject]', err);
              set((s) => ({
                projects: [...s.projects, project],
                tasks:    [...s.tasks, ...subtasks],
              }));
            });
        }
      },

      finishProject: (id) => {
        const prevProject = get().projects.find((p) => p.id === id);
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, status: 'finished', updatedAt: now() } : p
          ),
        }));
        const updated = get().projects.find((p) => p.id === id);
        if (updated?.backendId) {
          api.patchProject(updated.backendId, { is_finished: true }).catch((err) => {
            console.error('[finishProject]', err);
            if (prevProject) {
              set((s) => ({
                projects: s.projects.map((p) => (p.id === id ? prevProject : p)),
              }));
            }
          });
        }
      },

      reorderProject: (activeId, overId) => {
        const prevProjects = get().projects;
        const projects = [...prevProjects];
        const from = projects.findIndex((p) => p.id === activeId);
        const to   = projects.findIndex((p) => p.id === overId);
        if (from === -1 || to === -1) return;
        projects.splice(to, 0, projects.splice(from, 1)[0]);
        const reordered = assignSequentialSortOrders(projects);
        set({ projects: reordered });

        Promise.all(
          reordered
            .filter((project) => project.backendId)
            .map((project) =>
              api.patchProject(project.backendId!, { sort_order: project.sortOrder ?? 0 })
            )
        ).catch((err) => {
          console.error('[reorderProject]', err);
          set({ projects: prevProjects });
        });
      },

      setProjectTag: (projectId, tagId) => {
        const prevProject = get().projects.find((p) => p.id === projectId);
        if (!prevProject) return;

        const prevTasks = get().tasks.filter((t) => t.projectId === projectId);
        const ts = now();

        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, tagId, updatedAt: ts } : p
          ),
          tasks: s.tasks.map((t) =>
            t.projectId === projectId ? { ...t, tagId, updatedAt: ts } : t
          ),
        }));

        const { tags } = get();
        const projectPatch = prevProject.backendId
          ? api.patchProject(prevProject.backendId, {
              tag_id: api.resolveTagBackendId(tagId, tags),
            })
          : Promise.resolve();

        const taskPatches = prevTasks
          .filter((t) => t.backendId)
          .map((t) =>
            api.patchTask(t.backendId!, {
              tag_id: api.resolveTagBackendId(tagId, tags),
            })
          );

        Promise.all([projectPatch, ...taskPatches]).catch((err) => {
          console.error('[setProjectTag]', err);
          set((s) => ({
            projects: s.projects.map((p) => (p.id === projectId ? prevProject : p)),
            tasks: s.tasks.map((t) => {
              const prevTask = prevTasks.find((pt) => pt.id === t.id);
              return prevTask ? prevTask : t;
            }),
          }));
        });
      },

      // ── Tags ───────────────────────────────────────────────────────────

      addTag: (data) => {
        const ts = now();
        const tag: Tag = {
          id:        uid(),
          name:      data.name,
          color:     data.color,
          colorDark: data.colorDark,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ tags: [...s.tags, tag] }));

        api.createTag(tag)
          .then(({ id: backendId }) => {
            set((s) => ({
              tags: s.tags.map((t) => (t.id === tag.id ? { ...t, backendId } : t)),
            }));
          })
          .catch((err) => {
            console.error('[addTag]', err);
            set((s) => ({ tags: s.tags.filter((t) => t.id !== tag.id) }));
          });
      },

      updateTag: (id, data) => {
        const prevTag = get().tags.find((t) => t.id === id);
        set((s) => ({
          tags: s.tags.map((t) => (t.id === id ? { ...t, ...data, updatedAt: now() } : t)),
        }));
        const updated = get().tags.find((t) => t.id === id);
        if (updated?.backendId) {
          const apiFields: Record<string, unknown> = {};
          if ('name' in data)      apiFields.name       = data.name;
          if ('color' in data)     apiFields.color      = data.color;
          if ('colorDark' in data) apiFields.color_dark = data.colorDark;

          api.patchTag(updated.backendId, apiFields).catch((err) => {
            console.error('[updateTag]', err);
            if (prevTag) {
              set((s) => ({ tags: s.tags.map((t) => (t.id === id ? prevTag : t)) }));
            }
          });
        }
      },

      deleteTag: (id) => {
        const tag             = get().tags.find((t) => t.id === id);
        const prevTasks       = get().tasks;
        const prevProjects    = get().projects;
        set((s) => ({
          tags:     s.tags.filter((t) => t.id !== id),
          tasks:    s.tasks.map((t) => (t.tagId === id ? { ...t, tagId: undefined, updatedAt: now() } : t)),
          projects: s.projects.map((p) => (p.tagId === id ? { ...p, tagId: undefined, updatedAt: now() } : p)),
        }));
        if (tag?.backendId) {
          api.deleteTag(tag.backendId).catch((err) => {
            console.error('[deleteTag]', err);
            if (tag) {
              set((s) => ({
                tags:     [...s.tags, tag],
                tasks:    prevTasks,
                projects: prevProjects,
              }));
            }
          });
        }
      },

      setTaskTag: (taskId, tagId) => {
        const prevTasks = get().tasks;
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, tagId, updatedAt: now() } : t
          ),
        }));
        const task = get().tasks.find((t) => t.id === taskId);
        if (task?.backendId) {
          api.patchTask(task.backendId, {
            tag_id: api.resolveTagBackendId(tagId, get().tags),
          }).catch((err) => {
            console.error('[setTaskTag]', err);
            set({ tasks: prevTasks });
          });
        }
      },

      setRecurrentTaskTag: (id, tagId) => {
        const prevRecurrentTasks = get().recurrentTasks;
        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((task) =>
            task.id === id ? { ...task, tagId, updatedAt: now() } : task
          ),
        }));
        const task = get().recurrentTasks.find((recurrentTask) => recurrentTask.id === id);
        if (task?.backendId) {
          api.patchRecurrentTask(task.backendId, {
            tag_id: api.resolveTagBackendId(tagId, get().tags),
          }).catch((err) => {
            console.error('[setRecurrentTaskTag]', err);
            set({ recurrentTasks: prevRecurrentTasks });
          });
        }
      },

      // ── DnD ────────────────────────────────────────────────────────────

      reorderTask: (activeId, overId) => {
        const prevTasks = get().tasks;
        const tasks = [...prevTasks];
        const from = tasks.findIndex((t) => t.id === activeId);
        const to   = tasks.findIndex((t) => t.id === overId);
        if (from === -1 || to === -1) return;

        tasks.splice(to, 0, tasks.splice(from, 1)[0]);

        const activeTask = tasks.find((t) => t.id === activeId);
        const overTask = tasks.find((t) => t.id === overId);
        if (!activeTask || !overTask) return;
        if (taskBucketKey(activeTask) !== taskBucketKey(overTask)) {
          set({ tasks });
          return;
        }

        const bucketKey = taskBucketKey(activeTask);
        const bucketTasks = assignSequentialSortOrders(tasks.filter((t) => taskBucketKey(t) === bucketKey));
        let bucketIndex = 0;
        const reordered = tasks.map((task) =>
          taskBucketKey(task) === bucketKey ? bucketTasks[bucketIndex++] : task
        );
        set({ tasks: reordered });

        Promise.all(
          bucketTasks
            .filter((task) => task.backendId)
            .map((task) => api.patchTask(task.backendId!, { sort_order: task.sortOrder ?? 0 }))
        ).catch((err) => {
          console.error('[reorderTask]', err);
          set({ tasks: prevTasks });
        });
      },

      moveTask: (taskId, dest) => {
        const prevTask = get().tasks.find((t) => t.id === taskId);
        if (!prevTask) return;
        const prevTasks = get().tasks;
        const prevProjects = get().projects;
        const ts = now();
        const nextProjectId =
          dest.location === 'project'
            ? dest.projectId
            : prevTask.projectId;
        const preservedRecurringDate =
          prevTask.recurrentTaskId && dest.location === 'backlog'
            ? prevTask.date ?? getRecurrentCycleDueDate(
                get().recurrentTasks.find((task) => task.id === prevTask.recurrentTaskId)!,
                today,
              )
            : undefined;
        const nextDate = dest.location === 'project' ? undefined : (dest.date ?? preservedRecurringDate);
        const nextStartTime = dest.location === 'myday' ? dest.startTime : undefined;
        const nextEndTime = dest.location === 'myday' ? dest.endTime : undefined;

        const destTagId =
          dest.location === 'project' && dest.projectId
            ? get().projects.find((p) => p.id === dest.projectId)?.tagId
            : undefined;

        set((s) => {
          let updatedTasks = s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  location:  dest.location,
                  date:      nextDate,
                  projectId: nextProjectId,
                  startTime: nextStartTime,
                  endTime:   nextEndTime,
                  sortOrder: 0,
                  tagId:     dest.location === 'project' ? destTagId : t.tagId,
                  updatedAt: ts,
                }
              : t
          );
          const sourceBucket = taskBucketKey(prevTask);
          const destBucket = taskBucketKey({
            location: dest.location,
            date: nextDate,
            projectId: nextProjectId,
          });
          const rebalanceBucket = (bucketKey: string) => {
            const bucketTasks = assignSequentialSortOrders(updatedTasks.filter((task) => taskBucketKey(task) === bucketKey));
            let bucketIndex = 0;
            updatedTasks = updatedTasks.map((task) =>
              taskBucketKey(task) === bucketKey ? bucketTasks[bucketIndex++] : task
            );
          };
          rebalanceBucket(sourceBucket);
          if (destBucket !== sourceBucket) rebalanceBucket(destBucket);
          let projects = s.projects;
          if (prevTask.projectId && prevTask.projectId !== nextProjectId) {
            projects = projects.map((p) =>
              p.id === prevTask.projectId
                ? { ...p, subtaskIds: p.subtaskIds.filter((id) => id !== taskId), updatedAt: ts }
                : p
            );
          }
          if (nextProjectId && prevTask.projectId !== nextProjectId) {
            projects = projects.map((p) =>
              p.id === nextProjectId && !p.subtaskIds.includes(taskId)
                ? { ...p, subtaskIds: [...p.subtaskIds, taskId], updatedAt: ts }
                : p
            );
          }
          return { tasks: updatedTasks, projects };
        });

        const movedTask = get().tasks.find((t) => t.id === taskId);
        if (movedTask?.backendId) {
          const updatedTasks = get().tasks;
          const sourceBucket = taskBucketKey(prevTask);
          const destBucket = taskBucketKey({
            location: dest.location,
            date: nextDate,
            projectId: nextProjectId,
          });
          const affectedTasks = updatedTasks.filter((task) => {
            const key = taskBucketKey(task);
            return key === sourceBucket || key === destBucket;
          });
          Promise.all(
            affectedTasks
              .filter((task) => task.backendId)
              .map((task) =>
                api.patchTask(task.backendId!, {
                  location: task.location,
                  task_date: task.date ?? null,
                  project_id: task.projectId
                    ? get().projects.find((p) => p.id === task.projectId)?.backendId ?? null
                    : null,
                  start_time: task.startTime ? `${task.startTime}:00` : null,
                  end_time: task.endTime ? `${task.endTime}:00` : null,
                  sort_order: task.sortOrder ?? 0,
                })
              )
          ).catch((err) => {
            console.error('[moveTask]', err);
            set({
              tasks: prevTasks,
              projects: prevProjects,
            });
          });
        }
      },

      spawnRecurrentInstance: (recId, dest) => {
        const rt = get().recurrentTasks.find((r) => r.id === recId);
        if (!rt) return;
        const ts = now();
        const cycleDate = dest.date ?? getRecurrentCycleDueDate(rt, today);
        const newTask: Task = {
          id:              uid(),
          sortOrder:       nextTaskSortOrder(get().tasks, {
            location: dest.location,
            date: cycleDate,
            projectId: undefined,
          }),
          title:           rt.title,
          status:          api.isRecurrentCycleComplete(rt.frequency, rt.anchorDate, rt.completedThroughDate, cycleDate)
            ? 'done'
            : 'pending',
          location:        dest.location,
          date:            cycleDate,
          recurrentTaskId: recId,
          tagId:           rt.tagId,
          notes:           rt.notes,
          createdAt:       ts,
          updatedAt:       ts,
        };
        set((s) => ({ tasks: [...s.tasks, newTask] }));

        const { projects, recurrentTasks, tags } = get();
        api.createTask(newTask, projects, recurrentTasks, tags)
          .then(({ id: backendId }) => {
            set((s) => ({
              tasks: s.tasks.map((t) => (t.id === newTask.id ? { ...t, backendId } : t)),
            }));
          })
          .catch((err) => {
            console.error('[spawnRecurrentInstance]', err);
            set((s) => ({ tasks: s.tasks.filter((t) => t.id !== newTask.id) }));
          });
      },

      // ── Filter ─────────────────────────────────────────────────────────
      setActiveTagFilter: (id) => set({ activeTagFilter: id }),

      // ── Google Calendar ────────────────────────────────────────────────
      googleCalendarEntries:  [],
      setGoogleCalendarEntries: (entries) => set({ googleCalendarEntries: entries }),
      reconcileGoogleCalendarEntries: (entries) =>
        set((s) => {
          const reconciled = reconcileFetchedGoogleEntries(entries, s.pendingGoogleMutations);
          return {
            googleCalendarEntries: reconciled.entries,
            pendingGoogleMutations: reconciled.pending,
          };
        }),
      applyOptimisticGoogleEntry: (entry) =>
        set((s) => {
          const baseId = googleBaseId(entry.id);
          const optimisticEntry = { ...entry, syncState: 'pending' as const };
          return {
            googleCalendarEntries: [
              ...s.googleCalendarEntries.filter((existing) => googleBaseId(existing.id) !== baseId),
              optimisticEntry,
            ],
            pendingGoogleMutations: {
              ...s.pendingGoogleMutations,
              [baseId]: { type: 'upsert', entry: optimisticEntry },
            },
          };
        }),
      applyOptimisticGoogleDelete: (entryId) =>
        set((s) => {
          const baseId = googleBaseId(entryId);
          return {
            googleCalendarEntries: s.googleCalendarEntries.filter(
              (entry) => googleBaseId(entry.id) !== baseId
            ),
            pendingGoogleMutations: {
              ...s.pendingGoogleMutations,
              [baseId]: { type: 'delete' },
            },
          };
        }),
      clearPendingGoogleMutation: (entryId) =>
        set((s) => {
          const baseId = googleBaseId(entryId);
          if (!(baseId in s.pendingGoogleMutations)) return {};
          const nextPending = { ...s.pendingGoogleMutations };
          delete nextPending[baseId];
          return { pendingGoogleMutations: nextPending };
        }),
      pendingGoogleMutations: {},
      pendingGoogleAllDayMutations: {},
      googleAllDayEvents:     [],
      setGoogleAllDayEvents:  (events)  => set({ googleAllDayEvents: events }),
      reconcileGoogleAllDayEvents: (events) =>
        set((s) => {
          const reconciled = reconcileFetchedAllDayEvents(events, s.pendingGoogleAllDayMutations);
          return {
            googleAllDayEvents: reconciled.events,
            pendingGoogleAllDayMutations: reconciled.pending,
          };
        }),
      applyOptimisticGoogleAllDayEvent: (event) =>
        set((s) => {
          const optimisticEvent = { ...event, syncState: 'pending' as const };
          return {
            googleAllDayEvents: [
              ...s.googleAllDayEvents.filter((existing) => existing.id !== event.id),
              optimisticEvent,
            ],
            pendingGoogleAllDayMutations: {
              ...s.pendingGoogleAllDayMutations,
              [event.id]: { type: 'upsert', event: optimisticEvent },
            },
          };
        }),
      applyOptimisticGoogleAllDayDelete: (eventId) =>
        set((s) => ({
          googleAllDayEvents: s.googleAllDayEvents.filter((event) => event.id !== eventId),
          pendingGoogleAllDayMutations: {
            ...s.pendingGoogleAllDayMutations,
            [eventId]: { type: 'delete' },
          },
        })),
      clearPendingGoogleAllDayMutation: (eventId) =>
        set((s) => {
          if (!(eventId in s.pendingGoogleAllDayMutations)) return {};
          const nextPending = { ...s.pendingGoogleAllDayMutations };
          delete nextPending[eventId];
          return { pendingGoogleAllDayMutations: nextPending };
        }),
      googleNeedsReconnect:   false,
      setGoogleNeedsReconnect: (v) => set({ googleNeedsReconnect: v }),
    }),
    {
      name: 'planner-ui',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: unknown) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
        const viewMode = state.viewMode;
        return {
          ...state,
          viewMode:
            viewMode === 'day' ||
            viewMode === 'week' ||
            viewMode === 'month' ||
            viewMode === 'year' ||
            viewMode === 'planner' ||
            viewMode === 'workload'
              ? viewMode
              : 'day',
          yearPreviewEnabled:
            typeof state.yearPreviewEnabled === 'boolean'
              ? state.yearPreviewEnabled
              : true,
          mediaItems:
            Array.isArray(state.mediaItems)
              ? state.mediaItems
              : [],
        };
      },
      // Only persist UI preferences — entities are owned by the backend now
      partialize: (s) => ({
        theme:            s.theme,
        viewMode:         s.viewMode,
        monthViewMode:    s.monthViewMode,
        monthTaskLayout:  s.monthTaskLayout,
        yearPreviewEnabled: s.yearPreviewEnabled,
        uncertaintyNotes: s.uncertaintyNotes,
        expandedProjectIds: s.expandedProjectIds,
        mediaItems: s.mediaItems,
      }),
    }
  )
);

// ─── Selectors ─────────────────────────────────────────────────────────────

export function selectTasksToday(tasks: Task[], date: string) {
  return sortBySortOrder(tasks.filter(
    (t) => t.date === date && (t.location === 'today' || t.location === 'upcoming')
  ));
}

export function selectMyDayTasks(tasks: Task[], date: string) {
  return tasks.filter((t) => t.location === 'myday' && t.date === date);
}

export function selectOverdueTasks(tasks: Task[]) {
  const realToday = format(new Date(), 'yyyy-MM-dd');
  return tasks.filter(
    (t) =>
      t.status === 'pending' &&
      t.date !== undefined &&
      t.date < realToday &&
      (t.location === 'today' || t.location === 'myday' || t.location === 'upcoming')
  );
}

export function selectBacklogTasks(tasks: Task[]) {
  return sortBySortOrder(tasks.filter((t) => t.location === 'backlog'));
}

export function selectUpcomingTasks(tasks: Task[], currentDate: string) {
  const maxUpcomingDate = format(addDays(new Date(currentDate + 'T00:00:00'), 3), 'yyyy-MM-dd');
  return tasks
    .filter(
      (t) =>
        t.date !== undefined &&
        t.date > currentDate &&
        t.date <= maxUpcomingDate &&
        (t.location === 'upcoming' || t.location === 'today')
    )
    .sort((a, b) => {
      const dateDiff = a.date!.localeCompare(b.date!);
      if (dateDiff !== 0) return dateDiff;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
}

export function selectProjectTasks(tasks: Task[], projectId: string) {
  return sortBySortOrder(tasks.filter((t) => t.projectId === projectId));
}

export function selectActiveProjects(projects: Project[]) {
  return sortBySortOrder(projects.filter((p) => p.status === 'active'));
}

export function selectFinishedProjects(projects: Project[]) {
  return sortBySortOrder(projects.filter((p) => p.status === 'finished'));
}

export function selectRecurrentTasksSorted(recurrentTasks: RecurrentTask[]) {
  return [...recurrentTasks].sort((a, b) => {
    const aCompleted = isRecurrentTaskCompleted(a);
    const bCompleted = isRecurrentTaskCompleted(b);
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
    const dueDiff = a.nextDueDate.localeCompare(b.nextDueDate);
    if (dueDiff !== 0) return dueDiff;
    return a.title.localeCompare(b.title);
  });
}

export function selectGoogleCalendarEntriesForDate(entries: CalendarEntry[], date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const windowStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const windowEnd = new Date(year, month - 1, day, 26, 0, 0, 0);

  const mergedEntries = Array.from(
    entries.reduce((groups, entry) => {
      const baseId = entry.id.split('::')[0];
      const existing = groups.get(baseId);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(baseId, [entry]);
      }
      return groups;
    }, new Map<string, CalendarEntry[]>()).entries()
  ).map(([baseId, segments]) => {
    if (segments.some((segment) => segment.startDate || segment.endDate)) {
      const primary = segments.find((segment) => segment.id === baseId) ?? segments[0];
      return {
        ...primary,
        id: baseId,
        startDate: primary.startDate ?? primary.date,
        endDate: primary.endDate ?? primary.startDate ?? primary.date,
      };
    }

    const sortedSegments = [...segments].sort((a, b) => {
      if (a.date === b.date) return a.startTime > b.startTime ? 1 : -1;
      return a.date > b.date ? 1 : -1;
    });
    const firstSegment = sortedSegments[0];
    const lastSegment = sortedSegments[sortedSegments.length - 1];

    return {
      ...firstSegment,
      id: baseId,
      startDate: firstSegment.date,
      endDate: lastSegment.date,
      date: firstSegment.date,
      startTime: firstSegment.startTime,
      endTime: lastSegment.endTime,
    };
  });

  return mergedEntries
    .flatMap((entry) => {
      const startDate = entry.startDate ?? entry.date;
      const endDate = entry.endDate ?? startDate;
      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
      const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

      const entryStart = new Date(startYear, startMonth - 1, startDay, 0, timeToMinutes(entry.startTime), 0, 0);
      const entryEnd = new Date(endYear, endMonth - 1, endDay, 0, timeToMinutes(entry.endTime), 0, 0);

      if (entryEnd <= windowStart || entryStart >= windowEnd) return [];

      const visibleStart = entryStart > windowStart ? entryStart : windowStart;
      const visibleEnd = entryEnd < windowEnd ? entryEnd : windowEnd;
      const startMinutes = Math.round((visibleStart.getTime() - windowStart.getTime()) / 60000);
      const endMinutes = Math.round((visibleEnd.getTime() - windowStart.getTime()) / 60000);

      return [{
        ...entry,
        date,
        startTime: minutesToTime(startMinutes),
        endTime: minutesToTime(endMinutes),
      }];
    })
    .sort((a, b) => (a.startTime > b.startTime ? 1 : -1));
}

export function selectMergedGoogleCalendarEntryById(entries: CalendarEntry[], entryId: string): CalendarEntry | undefined {
  const baseId = entryId.split('::')[0];
  const grouped = entries.filter((entry) => entry.id.split('::')[0] === baseId);
  if (grouped.length === 0) return undefined;

  if (grouped.some((segment) => segment.startDate || segment.endDate)) {
    const primary = grouped.find((segment) => segment.id === baseId) ?? grouped[0];
    return {
      ...primary,
      id: baseId,
      startDate: primary.startDate ?? primary.date,
      endDate: primary.endDate ?? primary.startDate ?? primary.date,
    };
  }

  const sortedSegments = [...grouped].sort((a, b) => {
    if (a.date === b.date) return a.startTime > b.startTime ? 1 : -1;
    return a.date > b.date ? 1 : -1;
  });
  const firstSegment = sortedSegments[0];
  const lastSegment = sortedSegments[sortedSegments.length - 1];

  return {
    ...firstSegment,
    id: baseId,
    startDate: firstSegment.date,
    endDate: lastSegment.date,
    date: firstSegment.date,
    startTime: firstSegment.startTime,
    endTime: lastSegment.endTime,
  };
}

export function selectGoogleAllDayEventsForDate(events: AllDayEvent[], date: string) {
  return events.filter((e) => {
    const endDate = e.endDate ?? e.date;
    return e.date <= date && date <= endDate;
  });
}

export function selectNextDayEarlyGoogleCalendarEntries(entries: CalendarEntry[], date: string): CalendarEntry[] {
  void entries;
  void date;
  return [];
}

/** Returns myday tasks from the day AFTER `date` that start before 02:00 (overflow zone). */
export function selectNextDayEarlyMyDayTasks(tasks: Task[], date: string): Task[] {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const nextDate = format(d, 'yyyy-MM-dd');
  return tasks.filter(
    (t) => t.location === 'myday' && t.date === nextDate && !!t.startTime && t.startTime < '02:00'
  );
}
