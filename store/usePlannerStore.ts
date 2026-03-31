'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addDays, format, subDays } from 'date-fns';
import * as api from '@/lib/api';
import type {
  Task,
  CalendarEntry,
  AllDayEvent,
  RecurrentTask,
  RecurrenceFrequency,
  Project,
  Tag,
  PlannerState,
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
  /** Hydrate the store with data fetched from the backend on boot. */
  hydrateFromBackend: (data: BootData) => void;
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
  setGoogleCalendarEntries: (entries: CalendarEntry[]) => void;
  googleAllDayEvents: AllDayEvent[];
  setGoogleAllDayEvents: (events: AllDayEvent[]) => void;
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
      viewMode:                   'day' as 'day' | 'week',
      uncertaintyNotes:           '',
      selectedProjectIdForNotes:  null,
      activeTagFilter:            null,
      // Entities start empty — populated by usePlannerData on boot
      tasks:           [],
      calendarEntries: [],
      recurrentTasks:  [],
      projects:        [],
      tags:            [],

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

      hydrateFromBackend: (data) => {
        // Derive subtaskIds from tasks (backend stores FK on task, not on project)
        const subtaskMap = new Map<string, string[]>();
        for (const task of data.tasks) {
          if (task.location === 'project' && task.projectId) {
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
          calendarEntries: data.calendarEntries,
          tags:            data.tags,
        });
      },

      // ── Tasks ──────────────────────────────────────────────────────────

      toggleTask: (id) => {
        const prevTask = get().tasks.find((t) => t.id === id);
        if (!prevTask) return;
        const newStatus: Task['status'] = prevTask.status === 'done' ? 'pending' : 'done';
        const ts = now();

        set((s) => {
          const tasks = s.tasks.map((t) =>
            t.id === id ? { ...t, status: newStatus, updatedAt: ts } : t
          );
          if (newStatus === 'done' && prevTask.recurrentTaskId) {
            const recurrentTasks = s.recurrentTasks.map((r) => {
              if (r.id !== prevTask.recurrentTaskId) return r;
              return { ...r, nextDueDate: computeNextDueDate(r.frequency, r.nextDueDate), updatedAt: ts };
            });
            return { tasks, recurrentTasks };
          }
          return { tasks };
        });

        if (prevTask.backendId) {
          api.patchTask(prevTask.backendId, { status: newStatus }).catch((err) => {
            console.error('[toggleTask]', err);
            // Rollback
            set((s) => ({
              tasks: s.tasks.map((t) => (t.id === id ? prevTask : t)),
            }));
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

        const { projects, recurrentTasks } = get();
        api.createTask(newTask, projects, recurrentTasks)
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
            merged.location  = 'backlog';
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

      // ── Calendar entries ───────────────────────────────────────────────

      addCalendarEntry: (data) => {
        const ts = now();
        const entry: CalendarEntry = {
          id:        uid(),
          title:     data.title,
          date:      data.date,
          startTime: data.startTime,
          endTime:   data.endTime,
          createdAt: ts,
          updatedAt: ts,
        };
        set((s) => ({ calendarEntries: [...s.calendarEntries, entry] }));

        api.createCalendarEntry(entry)
          .then(({ id: backendId }) => {
            set((s) => ({
              calendarEntries: s.calendarEntries.map((e) =>
                e.id === entry.id ? { ...e, backendId } : e
              ),
            }));
          })
          .catch((err) => {
            console.error('[addCalendarEntry]', err);
            set((s) => ({
              calendarEntries: s.calendarEntries.filter((e) => e.id !== entry.id),
            }));
          });
      },

      updateCalendarEntry: (id, updates) => {
        const prevEntry = get().calendarEntries.find((e) => e.id === id);
        set((s) => ({
          calendarEntries: s.calendarEntries.map((e) =>
            e.id === id ? { ...e, ...updates, updatedAt: now() } : e
          ),
        }));
        const updated = get().calendarEntries.find((e) => e.id === id);
        if (updated?.backendId) {
          const apiFields: Record<string, unknown> = {};
          if ('title' in updates)     apiFields.title      = updates.title;
          if ('notes' in updates)     apiFields.notes      = updates.notes ?? null;
          if ('startTime' in updates) apiFields.start_time = updates.startTime ? `${updates.startTime}:00` : null;
          if ('endTime' in updates)   apiFields.end_time   = updates.endTime   ? `${updates.endTime}:00`   : null;

          api.patchCalendarEntry(updated.backendId, apiFields).catch((err) => {
            console.error('[updateCalendarEntry]', err);
            if (prevEntry) {
              set((s) => ({
                calendarEntries: s.calendarEntries.map((e) => (e.id === id ? prevEntry : e)),
              }));
            }
          });
        }
      },

      deleteCalendarEntry: (id) => {
        const entry = get().calendarEntries.find((e) => e.id === id);
        set((s) => ({
          calendarEntries: s.calendarEntries.filter((e) => e.id !== id),
        }));
        if (entry?.backendId) {
          api.deleteCalendarEntry(entry.backendId).catch((err) => {
            console.error('[deleteCalendarEntry]', err);
            if (entry) {
              set((s) => ({ calendarEntries: [...s.calendarEntries, entry] }));
            }
          });
        }
      },

      // ── Recurrent tasks ────────────────────────────────────────────────

      addRecurrentTask: (data) => {
        const ts = now();
        const rt: RecurrentTask = {
          id:          uid(),
          title:       data.title,
          frequency:   data.frequency,
          nextDueDate: today,
          createdAt:   ts,
          updatedAt:   ts,
        };
        set((s) => ({ recurrentTasks: [...s.recurrentTasks, rt] }));

        api.createRecurrentTask(rt)
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
          recurrentTasks: s.recurrentTasks.map((r) =>
            r.id === id ? { ...r, ...updates, updatedAt: now() } : r
          ),
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

      advanceRecurrentTask: (id) =>
        set((s) => ({
          recurrentTasks: s.recurrentTasks.map((r) => {
            if (r.id !== id) return r;
            return { ...r, nextDueDate: computeNextDueDate(r.frequency, r.nextDueDate), updatedAt: now() };
          }),
        })),

      // ── Projects ───────────────────────────────────────────────────────

      addProject: (title) => {
        const ts = now();
        const project: Project = {
          id:          uid(),
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

      reorderProject: (activeId, overId) =>
        set((s) => {
          const projects = [...s.projects];
          const from = projects.findIndex((p) => p.id === activeId);
          const to   = projects.findIndex((p) => p.id === overId);
          if (from === -1 || to === -1) return {};
          projects.splice(to, 0, projects.splice(from, 1)[0]);
          return { projects };
          // Note: sort_order not synced to backend in Phase 2
        }),

      setProjectTag: (projectId, tagId) =>
        set((s) => {
          const ts = now();
          return {
            projects: s.projects.map((p) =>
              p.id === projectId ? { ...p, tagId, updatedAt: ts } : p
            ),
            tasks: s.tasks.map((t) =>
              t.projectId === projectId ? { ...t, tagId, updatedAt: ts } : t
            ),
          };
          // Note: tag associations not synced to backend in Phase 2
        }),

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

      setTaskTag: (taskId, tagId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, tagId, updatedAt: now() } : t
          ),
          // Note: tag associations not synced to backend in Phase 2
        })),

      // ── DnD ────────────────────────────────────────────────────────────

      reorderTask: (activeId, overId) =>
        set((s) => {
          const tasks = [...s.tasks];
          const from = tasks.findIndex((t) => t.id === activeId);
          const to   = tasks.findIndex((t) => t.id === overId);
          if (from === -1 || to === -1) return {};
          tasks.splice(to, 0, tasks.splice(from, 1)[0]);
          return { tasks };
          // Note: sort_order not synced to backend in Phase 2
        }),

      moveTask: (taskId, dest) => {
        const prevTask = get().tasks.find((t) => t.id === taskId);
        if (!prevTask) return;
        const ts = now();

        const destTagId =
          dest.location === 'project' && dest.projectId
            ? get().projects.find((p) => p.id === dest.projectId)?.tagId
            : undefined;

        set((s) => {
          const updatedTasks = s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  location:  dest.location,
                  date:      dest.date,
                  projectId: dest.projectId,
                  startTime: dest.startTime,
                  endTime:   dest.endTime,
                  tagId:     dest.location === 'project' ? destTagId : t.tagId,
                  updatedAt: ts,
                }
              : t
          );
          let projects = s.projects;
          if (prevTask.location === 'project' && prevTask.projectId) {
            projects = projects.map((p) =>
              p.id === prevTask.projectId
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
        });

        const movedTask = get().tasks.find((t) => t.id === taskId);
        if (movedTask?.backendId) {
          const projectBackendId = dest.projectId
            ? get().projects.find((p) => p.id === dest.projectId)?.backendId ?? null
            : null;
          api.patchTask(movedTask.backendId, {
            location:   dest.location,
            task_date:  dest.date ?? null,
            project_id: projectBackendId,
            start_time: dest.startTime ? `${dest.startTime}:00` : null,
            end_time:   dest.endTime   ? `${dest.endTime}:00`   : null,
          }).catch((err) => {
            console.error('[moveTask]', err);
            set((s) => ({
              tasks: s.tasks.map((t) => (t.id === taskId ? prevTask : t)),
            }));
          });
        }
      },

      spawnRecurrentInstance: (recId, dest) => {
        const rt = get().recurrentTasks.find((r) => r.id === recId);
        if (!rt) return;
        const ts = now();
        const newTask: Task = {
          id:              uid(),
          title:           rt.title,
          status:          'pending',
          location:        dest.location,
          date:            dest.date,
          recurrentTaskId: recId,
          notes:           rt.notes,
          createdAt:       ts,
          updatedAt:       ts,
        };
        set((s) => ({ tasks: [...s.tasks, newTask] }));

        const { projects, recurrentTasks } = get();
        api.createTask(newTask, projects, recurrentTasks)
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
      googleAllDayEvents:     [],
      setGoogleAllDayEvents:  (events)  => set({ googleAllDayEvents: events }),
      googleNeedsReconnect:   false,
      setGoogleNeedsReconnect: (v) => set({ googleNeedsReconnect: v }),
    }),
    {
      name: 'planner-v1',
      storage: createJSONStorage(() => localStorage),
      // Only persist UI preferences — entities are owned by the backend now
      partialize: (s) => ({
        theme:            s.theme,
        viewMode:         s.viewMode,
        uncertaintyNotes: s.uncertaintyNotes,
      }),
    }
  )
);

// ─── Recurrence helper ─────────────────────────────────────────────────────

function computeNextDueDate(freq: RecurrenceFrequency, fromDate: string): string {
  const base = new Date(fromDate + 'T00:00:00');
  switch (freq.type) {
    case 'daily':   return format(addDays(base, 1),                'yyyy-MM-dd');
    case 'weekly':  return format(addDays(base, 7),                'yyyy-MM-dd');
    case 'monthly': return format(addDays(base, 30),               'yyyy-MM-dd');
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

export function selectGoogleCalendarEntriesForDate(entries: CalendarEntry[], date: string) {
  return entries.filter((e) => e.date === date);
}

export function selectGoogleAllDayEventsForDate(events: AllDayEvent[], date: string) {
  return events.filter((e) => e.date === date);
}
