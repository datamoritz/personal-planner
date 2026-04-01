// ─── Core enums ────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'done';

export type TaskLocation =
  | 'today'
  | 'backlog'
  | 'upcoming'
  | 'myday'        // timed task placed on the time grid
  | 'project';     // subtask inside a project

export type RecurrenceFrequency =
  | { type: 'daily' }
  | { type: 'weekly'; dayOfWeek: number }   // 0=Sun … 6=Sat
  | { type: 'monthly'; dayOfMonth: number }
  | { type: 'custom'; intervalDays: number };

// ─── Tag ───────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  /** Backend integer PK — populated after first successful API sync */
  backendId?: number;
  name: string;
  /** Tailwind-compatible light background color, e.g. '#dcfce7' */
  color: string;
  /** Slightly deeper border/text color derived from the same hue */
  colorDark: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Task ──────────────────────────────────────────────────────────────────

export interface Task {
  id: string;           // UUID — used as client_id in backend
  /** Backend integer PK — populated after first successful API sync */
  backendId?: number;
  title: string;
  status: TaskStatus;
  location: TaskLocation;

  // Date this task belongs to (ISO date string: 'YYYY-MM-DD')
  // undefined = backlog (no date)
  date?: string;

  // If location === 'myday', the task has been placed on the time grid
  startTime?: string;  // 'HH:MM'
  endTime?: string;    // 'HH:MM'

  // FK → projects.id (frontend UUID)
  projectId?: string;

  // FK → recurrent_tasks.id (frontend UUID — set on spawned instances only)
  recurrentTaskId?: string;

  // FK → tags.id (single tag per task, not yet synced to backend)
  tagId?: string;

  notes?: string;
  createdAt: string;   // ISO datetime
  updatedAt: string;
}

// ─── Calendar Entry ────────────────────────────────────────────────────────

export interface CalendarEntry {
  id: string;           // UUID — used as client_id in backend
  /** Backend integer PK — populated after first successful API sync */
  backendId?: number;
  title: string;
  date: string;         // 'YYYY-MM-DD'
  startTime: string;    // 'HH:MM'
  endTime: string;      // 'HH:MM'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── All-Day Event (Google Calendar, read-only) ────────────────────────────

export interface AllDayEvent {
  id: string;
  title: string;
  date: string;         // 'YYYY-MM-DD' — multi-day events arrive as one entry per day
  source: 'google';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Recurrent Task ────────────────────────────────────────────────────────

export interface RecurrentTask {
  id: string;           // UUID — used as client_id in backend
  /** Backend integer PK — populated after first successful API sync */
  backendId?: number;
  title: string;
  frequency: RecurrenceFrequency;
  /** Client-only: computed from frequency on load, not stored in backend */
  nextDueDate: string;  // 'YYYY-MM-DD'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Project ───────────────────────────────────────────────────────────────

export interface Project {
  id: string;           // UUID — used as client_id in backend
  /** Backend integer PK — populated after first successful API sync */
  backendId?: number;
  title: string;
  /** Derived from tasks on hydration — not stored in backend */
  subtaskIds: string[];
  status: 'active' | 'finished';
  tagId?: string;        // FK → tags.id (not yet synced to backend)
  createdAt: string;
  updatedAt: string;
}

// ─── Day State (convenience shape for the store) ───────────────────────────

export interface PlannerState {
  /** Currently viewed date (ISO: 'YYYY-MM-DD') */
  currentDate: string;

  tasks: Task[];
  recurrentTasks: RecurrentTask[];
  projects: Project[];
  tags: Tag[];
}
