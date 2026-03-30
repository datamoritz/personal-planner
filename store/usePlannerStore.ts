'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addDays, format, subDays } from 'date-fns';
import type {
  Task,
  CalendarEntry,
  RecurrentTask,
  RecurrenceFrequency,
  Project,
  Tag,
  PlannerState,
} from '@/types';

// ─── Helpers ───────────────────────────────────────────────────────────────

const today     = format(new Date(), 'yyyy-MM-dd');
const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
const tomorrow  = format(addDays(new Date(), 1), 'yyyy-MM-dd');
const in2days   = format(addDays(new Date(), 2), 'yyyy-MM-dd');
const in4days   = format(addDays(new Date(), 4), 'yyyy-MM-dd');

/** UUID for all new entities — globally unique, safe as a future database PK. */
function uid(): string {
  return crypto.randomUUID();
}

/** ISO datetime string for createdAt / updatedAt. */
function now(): string {
  return new Date().toISOString();
}

// ─── Mock seed data ────────────────────────────────────────────────────────

const SEED_TASKS: Task[] = [
  // Tasks Today
  { id: uid(), title: 'Review pull request from Alex',       status: 'pending', location: 'today',   date: today,     notes: 'Focus on the auth middleware changes.', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Write weekly status update',          status: 'pending', location: 'today',   date: today,     createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Call dentist for appointment',        status: 'done',    location: 'today',   date: today,     createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Order new keyboard',                  status: 'pending', location: 'today',   date: today,     createdAt: now(), updatedAt: now() },

  // Timed tasks in My Day
  { id: uid(), title: 'Morning standup',        status: 'pending', location: 'myday', date: today, startTime: '09:00', endTime: '09:30', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Review product roadmap', status: 'pending', location: 'myday', date: today, startTime: '14:00', endTime: '15:00', recurrentTaskId: 'rec-seed-2', createdAt: now(), updatedAt: now() },

  // Overdue
  { id: uid(), title: 'Submit expense report', status: 'pending', location: 'today', date: yesterday, createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Reply to client email', status: 'pending', location: 'today', date: yesterday, notes: 'Re: the Q2 proposal.', createdAt: now(), updatedAt: now() },

  // Backlog
  { id: uid(), title: 'Research new project management tools', status: 'pending', location: 'backlog', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Update portfolio website',              status: 'pending', location: 'backlog', notes: 'Add last two projects.', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Read "Deep Work" chapter 3',            status: 'pending', location: 'backlog', createdAt: now(), updatedAt: now() },

  // Upcoming
  { id: uid(), title: 'Prepare slides for Thursday presentation', status: 'pending', location: 'upcoming', date: tomorrow,  createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Team lunch reservation',                   status: 'pending', location: 'upcoming', date: tomorrow,  createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Quarterly planning session',               status: 'pending', location: 'upcoming', date: in2days,   createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Submit tax documents',                     status: 'pending', location: 'upcoming', date: in4days,   createdAt: now(), updatedAt: now() },

  // Project subtasks (ids must match subtaskIds in SEED_PROJECTS)
  { id: 'task-seed-16', title: 'Define API contract',          status: 'done',    location: 'project', projectId: 'proj-seed-1', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-17', title: 'Implement user authentication', status: 'pending', location: 'project', projectId: 'proj-seed-1', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-18', title: 'Write integration tests',      status: 'pending', location: 'project', projectId: 'proj-seed-1', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-19', title: 'Deploy to staging',            status: 'pending', location: 'project', projectId: 'proj-seed-1', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-20', title: 'Choose color palette',         status: 'done',    location: 'project', projectId: 'proj-seed-2', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-21', title: 'Design homepage mockup',       status: 'done',    location: 'project', projectId: 'proj-seed-2', createdAt: now(), updatedAt: now() },
  { id: 'task-seed-22', title: 'Build responsive nav',         status: 'pending', location: 'project', projectId: 'proj-seed-2', createdAt: now(), updatedAt: now() },
];

const SEED_CALENDAR_ENTRIES: CalendarEntry[] = [
  { id: uid(), title: 'Product sync with Sarah', date: today, startTime: '10:00', endTime: '11:00', notes: 'Discuss Q2 feature prioritization.', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Lunch with Marco',         date: today, startTime: '12:30', endTime: '13:30', createdAt: now(), updatedAt: now() },
  { id: uid(), title: 'Design review',            date: today, startTime: '15:30', endTime: '16:15', notes: 'Review new onboarding screens.',      createdAt: now(), updatedAt: now() },
];

const SEED_RECURRENT_TASKS: RecurrentTask[] = [
  { id: 'rec-seed-1', title: 'Buy groceries',         frequency: { type: 'weekly', dayOfWeek: 6 },  nextDueDate: today,     createdAt: now(), updatedAt: now() },
  { id: 'rec-seed-2', title: 'Review product roadmap', frequency: { type: 'weekly', dayOfWeek: 1 },  nextDueDate: tomorrow,  createdAt: now(), updatedAt: now() },
  { id: 'rec-seed-3', title: 'Vacuum apartment',       frequency: { type: 'weekly', dayOfWeek: 0 },  nextDueDate: in2days,   createdAt: now(), updatedAt: now() },
  { id: 'rec-seed-4', title: 'Pay credit card',        frequency: { type: 'monthly', dayOfMonth: 1 }, nextDueDate: in4days,  createdAt: now(), updatedAt: now() },
  { id: 'rec-seed-5', title: 'Daily standup notes',    frequency: { type: 'daily' },                  nextDueDate: today,     createdAt: now(), updatedAt: now() },
];

const SEED_PROJECTS: Project[] = [
  { id: 'proj-seed-1', title: 'Backend API v2',    subtaskIds: ['task-seed-16', 'task-seed-17', 'task-seed-18', 'task-seed-19'], status: 'active',   createdAt: now(), updatedAt: now() },
  { id: 'proj-seed-2', title: 'Website Redesign',  subtaskIds: ['task-seed-20', 'task-seed-21', 'task-seed-22'],                 status: 'active',   createdAt: now(), updatedAt: now() },
  { id: 'proj-seed-3', title: 'Onboarding Docs',   subtaskIds: [],                                                               status: 'finished', createdAt: now(), updatedAt: now() },
];

// ─── Store interface ────────────────────────────────────────────────────────

interface PlannerStore extends PlannerState {
  theme: 'dark' | 'light';
  viewMode: 'day' | 'week';
  uncertaintyNotes: string;
  setUncertaintyNotes: (text: string) => void;
  selectedProjectIdForNotes: string | null;
  setSelectedProjectIdForNotes: (id: string | null) => void;
  toggleTheme: () => void;
  setCurrentDate: (date: string) => void;
  navigateDay: (direction: 'prev' | 'next') => void;
  navigateWeek: (direction: 'prev' | 'next') => void;
  setViewMode: (mode: 'day' | 'week') => void;
  // Tasks
  toggleTask: (id: string) => void;
  addTask: (data: { title: string; location: Task['location']; date?: string; projectId?: string }) => void;
  updateTask: (id: string, updates: Partial<Pick<Task, 'title' | 'notes' | 'date' | 'startTime' | 'endTime'>>) => void;
  deleteTask: (id: string) => void;
  // Calendar entries
  addCalendarEntry: (data: { title: string; date: string; startTime: string; endTime: string }) => void;
  updateCalendarEntry: (id: string, updates: Partial<Pick<CalendarEntry, 'title' | 'notes' | 'startTime' | 'endTime'>>) => void;
  deleteCalendarEntry: (id: string) => void;
  // Recurrent tasks
  addRecurrentTask: (data: { title: string; frequency: RecurrenceFrequency }) => void;
  updateRecurrentTask: (id: string, updates: Partial<Pick<RecurrentTask, 'title' | 'notes' | 'frequency'>>) => void;
  deleteRecurrentTask: (id: string) => void;
  advanceRecurrentTask: (id: string) => void;
  // Projects
  addProject: (title: string) => void;
  deleteProject: (id: string) => void;
  finishProject: (id: string) => void;
  reorderProject: (activeId: string, overId: string) => void;
  // Tags
  addTag: (data: { name: string; color: string; colorDark: string }) => void;
  updateTag: (id: string, data: { name?: string; color?: string; colorDark?: string }) => void;
  deleteTag: (id: string) => void;
  setTaskTag: (taskId: string, tagId: string | undefined) => void;
  // Filter
  activeTagFilter: string | null;
  setActiveTagFilter: (id: string | null) => void;
  // DnD
  reorderTask: (activeId: string, overId: string) => void;
  moveTask: (taskId: string, dest: { location: Task['location']; date?: string; projectId?: string; startTime?: string; endTime?: string }) => void;
  spawnRecurrentInstance: (recId: string, dest: { location: Task['location']; date?: string }) => void;
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set, get) => ({
      currentDate: today,
      theme: 'light',
      viewMode: 'day' as 'day' | 'week',
      uncertaintyNotes: '',
      selectedProjectIdForNotes: null,
      activeTagFilter: null,
      tasks: SEED_TASKS,
      calendarEntries: SEED_CALENDAR_ENTRIES,
      recurrentTasks: SEED_RECURRENT_TASKS,
      projects: SEED_PROJECTS,
      tags: [
        { id: 'tag-work',    name: 'Work',    color: '#dbeafe', colorDark: '#3b82f6', createdAt: now() },
        { id: 'tag-study',   name: 'Study',   color: '#ede9fe', colorDark: '#8b5cf6', createdAt: now() },
        { id: 'tag-health',  name: 'Health',  color: '#dcfce7', colorDark: '#22c55e', createdAt: now() },
        { id: 'tag-personal',name: 'Personal',color: '#fef9c3', colorDark: '#eab308', createdAt: now() },
      ] as Tag[],

      setUncertaintyNotes: (text) => set({ uncertaintyNotes: text }),
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

      setViewMode: (mode) => set({ viewMode: mode }),

      toggleTask: (id) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task) return {};
          const newStatus: Task['status'] = task.status === 'done' ? 'pending' : 'done';
          const ts = now();
          const tasks = s.tasks.map((t) =>
            t.id === id ? { ...t, status: newStatus, updatedAt: ts } : t
          );
          if (newStatus === 'done' && task.recurrentTaskId) {
            const recurrentTasks = s.recurrentTasks.map((r) => {
              if (r.id !== task.recurrentTaskId) return r;
              return { ...r, nextDueDate: computeNextDueDate(r.frequency, r.nextDueDate), updatedAt: ts };
            });
            return { tasks, recurrentTasks };
          }
          return { tasks };
        }),

      addTask: (data) => {
        const ts = now();
        const newTask: Task = {
          id: uid(),
          title: data.title,
          status: 'pending',
          location: data.location,
          date: data.date,
          projectId: data.projectId,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => {
          const tasks = [...s.tasks, newTask];
          if (data.location === 'project' && data.projectId) {
            const projects = s.projects.map((p) =>
              p.id === data.projectId
                ? { ...p, subtaskIds: [...p.subtaskIds, newTask.id], updatedAt: ts }
                : p
            );
            return { tasks, projects };
          }
          return { tasks };
        });
      },

      updateTask: (id, updates) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task) return {};
          // If date is explicitly cleared on a dated task, move it to backlog (first position)
          const clearingDate =
            'date' in updates &&
            updates.date === undefined &&
            task.date !== undefined &&
            (task.location === 'today' || task.location === 'upcoming');
          const merged = { ...task, ...updates, updatedAt: now() };
          if (clearingDate) {
            merged.location  = 'backlog';
            merged.date      = undefined;
            merged.startTime = undefined;
            merged.endTime   = undefined;
            // Prepend to task list so it appears first in backlog
            const others = s.tasks.filter((t) => t.id !== id);
            return { tasks: [merged, ...others] };
          }
          return { tasks: s.tasks.map((t) => (t.id === id ? merged : t)) };
        }),

      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          projects: s.projects.map((p) => ({
            ...p,
            subtaskIds: p.subtaskIds.filter((sid) => sid !== id),
            updatedAt: now(),
          })),
        })),

      addCalendarEntry: (data) => {
        const ts = now();
        const entry: CalendarEntry = {
          id: uid(),
          title: data.title,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ calendarEntries: [...s.calendarEntries, entry] }));
      },

      updateCalendarEntry: (id, updates) =>
        set((s) => ({
          calendarEntries: s.calendarEntries.map((e) =>
            e.id === id ? { ...e, ...updates, updatedAt: now() } : e
          ),
        })),

      deleteCalendarEntry: (id) =>
        set((s) => ({
          calendarEntries: s.calendarEntries.filter((e) => e.id !== id),
        })),

      addRecurrentTask: (data) => {
        const ts = now();
        const rt: RecurrentTask = {
          id: uid(),
          title: data.title,
          frequency: data.frequency,
          nextDueDate: today,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ recurrentTasks: [...s.recurrentTasks, rt] }));
      },

      updateRecurrentTask: (id, updates) =>
        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((r) =>
            r.id === id ? { ...r, ...updates, updatedAt: now() } : r
          ),
        })),

      deleteRecurrentTask: (id) =>
        set((s) => ({
          recurrentTasks: s.recurrentTasks.filter((r) => r.id !== id),
          // Also remove spawned instances that reference this template
          tasks: s.tasks.filter((t) => t.recurrentTaskId !== id),
        })),

      advanceRecurrentTask: (id) =>
        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((r) => {
            if (r.id !== id) return r;
            return { ...r, nextDueDate: computeNextDueDate(r.frequency, r.nextDueDate), updatedAt: now() };
          }),
        })),

      addProject: (title) => {
        const ts = now();
        const project: Project = {
          id: uid(),
          title,
          subtaskIds: [],
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ projects: [...s.projects, project] }));
      },

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          tasks: s.tasks.filter((t) => t.projectId !== id),
        })),

      finishProject: (id) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, status: 'finished', updatedAt: now() } : p
          ),
        })),

      reorderProject: (activeId, overId) =>
        set((s) => {
          const projects = [...s.projects];
          const from = projects.findIndex((p) => p.id === activeId);
          const to   = projects.findIndex((p) => p.id === overId);
          if (from === -1 || to === -1) return {};
          projects.splice(to, 0, projects.splice(from, 1)[0]);
          return { projects };
        }),

      reorderTask: (activeId, overId) =>
        set((s) => {
          const tasks = [...s.tasks];
          const from = tasks.findIndex((t) => t.id === activeId);
          const to   = tasks.findIndex((t) => t.id === overId);
          if (from === -1 || to === -1) return {};
          tasks.splice(to, 0, tasks.splice(from, 1)[0]);
          return { tasks };
        }),

      moveTask: (taskId, dest) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === taskId);
          if (!task) return {};
          const ts = now();

          const updatedTasks = s.tasks.map((t) =>
            t.id === taskId
              ? { ...t, location: dest.location, date: dest.date, projectId: dest.projectId, startTime: dest.startTime, endTime: dest.endTime, updatedAt: ts }
              : t
          );

          let projects = s.projects;
          if (task.location === 'project' && task.projectId) {
            projects = projects.map((p) =>
              p.id === task.projectId
                ? { ...p, subtaskIds: p.subtaskIds.filter((id) => id !== taskId), updatedAt: ts }
                : p
            );
          }
          if (dest.location === 'project' && dest.projectId) {
            projects = projects.map((p) =>
              p.id === dest.projectId && !p.subtaskIds.includes(taskId)
                ? { ...p, subtaskIds: [...p.subtaskIds, taskId], updatedAt: ts }
                : p
            );
          }
          return { tasks: updatedTasks, projects };
        }),

      setActiveTagFilter: (id) => set({ activeTagFilter: id }),

      addTag: (data) => {
        const tag: Tag = { id: uid(), name: data.name, color: data.color, colorDark: data.colorDark, createdAt: now() };
        set((s) => ({ tags: [...s.tags, tag] }));
      },

      updateTag: (id, data) =>
        set((s) => ({ tags: s.tags.map((t) => t.id === id ? { ...t, ...data } : t) })),

      deleteTag: (id) =>
        set((s) => ({
          tags: s.tags.filter((t) => t.id !== id),
          tasks: s.tasks.map((t) => t.tagId === id ? { ...t, tagId: undefined, updatedAt: now() } : t),
        })),

      setTaskTag: (taskId, tagId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => t.id === taskId ? { ...t, tagId, updatedAt: now() } : t),
        })),

      spawnRecurrentInstance: (recId, dest) => {
        const rt = get().recurrentTasks.find((r) => r.id === recId);
        if (!rt) return;
        const ts = now();
        const newTask: Task = {
          id: uid(),
          title: rt.title,
          status: 'pending',
          location: dest.location,
          date: dest.date,
          recurrentTaskId: recId,
          notes: rt.notes,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ tasks: [...s.tasks, newTask] }));
      },
    }),
    {
      name: 'planner-v1',           // localStorage key
      storage: createJSONStorage(() => localStorage),
      // currentDate is intentionally excluded — always boot to real today
      partialize: (s) => ({
        theme: s.theme,
        viewMode: s.viewMode,
        uncertaintyNotes: s.uncertaintyNotes,
        tasks: s.tasks,
        calendarEntries: s.calendarEntries,
        recurrentTasks: s.recurrentTasks,
        projects: s.projects,
        tags: s.tags,
      }),
    }
  )
);

// ─── Recurrence helper ─────────────────────────────────────────────────────

function computeNextDueDate(freq: RecurrenceFrequency, fromDate: string): string {
  const base = new Date(fromDate + 'T00:00:00');
  switch (freq.type) {
    case 'daily':   return format(addDays(base, 1),               'yyyy-MM-dd');
    case 'weekly':  return format(addDays(base, 7),               'yyyy-MM-dd');
    case 'monthly': return format(addDays(base, 30),              'yyyy-MM-dd');
    case 'custom':  return format(addDays(base, freq.intervalDays), 'yyyy-MM-dd');
  }
}

// ─── Selectors ─────────────────────────────────────────────────────────────

export function selectTasksToday(tasks: Task[], date: string) {
  return tasks.filter(
    (t) => t.date === date && (t.location === 'today' || t.location === 'upcoming')
  );
}

export function selectMyDayTasks(tasks: Task[], date: string) {
  return tasks.filter((t) => t.location === 'myday' && t.date === date);
}

export function selectCalendarEntriesForDate(entries: CalendarEntry[], date: string) {
  return entries.filter((e) => e.date === date);
}

/** Overdue is always relative to real calendar today — not the viewed date. */
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
  return tasks.filter((t) => t.location === 'backlog');
}

export function selectUpcomingTasks(tasks: Task[], currentDate: string) {
  return tasks
    .filter((t) => t.location === 'upcoming' && t.date !== undefined && t.date > currentDate)
    .sort((a, b) => (a.date! > b.date! ? 1 : -1));
}

export function selectProjectTasks(tasks: Task[], projectId: string) {
  return tasks.filter((t) => t.location === 'project' && t.projectId === projectId);
}

export function selectActiveProjects(projects: Project[]) {
  return projects.filter((p) => p.status === 'active');
}

export function selectFinishedProjects(projects: Project[]) {
  return projects.filter((p) => p.status === 'finished');
}

export function selectRecurrentTasksSorted(recurrentTasks: RecurrentTask[]) {
  return [...recurrentTasks].sort((a, b) => (a.nextDueDate > b.nextDueDate ? 1 : -1));
}
