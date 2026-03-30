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
  name: string;
  /** Tailwind-compatible light background color, e.g. '#dcfce7' */
  color: string;
  /** Slightly deeper border/text color derived from the same hue */
  colorDark: string;
  createdAt: string;
}

// ─── Task ──────────────────────────────────────────────────────────────────

export interface Task {
  id: string;           // UUID — future PK in tasks table
  title: string;
  status: TaskStatus;
  location: TaskLocation;

  // Date this task belongs to (ISO date string: 'YYYY-MM-DD')
  // undefined = backlog (no date)
  date?: string;

  // If location === 'myday', the task has been placed on the time grid
  startTime?: string;  // 'HH:MM'
  endTime?: string;    // 'HH:MM'

  // FK → projects.id
  projectId?: string;

  // FK → recurrent_tasks.id (set on spawned instances only)
  recurrentTaskId?: string;

  // FK → tags.id (single tag per task)
  tagId?: string;

  notes?: string;
  createdAt: string;   // ISO datetime
  updatedAt: string;   // ISO datetime — for future sync/conflict resolution
}

// ─── Calendar Entry ────────────────────────────────────────────────────────

export interface CalendarEntry {
  id: string;           // UUID — future PK in calendar_entries table
  title: string;
  date: string;         // 'YYYY-MM-DD'
  startTime: string;    // 'HH:MM'
  endTime: string;      // 'HH:MM'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Recurrent Task ────────────────────────────────────────────────────────

export interface RecurrentTask {
  id: string;           // UUID — future PK in recurrent_tasks table
  title: string;
  frequency: RecurrenceFrequency;  // stored as jsonb in Postgres
  nextDueDate: string;  // 'YYYY-MM-DD' — used for ordering (soonest = top)
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Project ───────────────────────────────────────────────────────────────

export interface Project {
  id: string;           // UUID — future PK in projects table
  title: string;
  subtaskIds: string[];  // ordered FK refs → tasks.id
  status: 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
}

// ─── Day State (convenience shape for the store) ───────────────────────────

export interface PlannerState {
  /** Currently viewed date (ISO: 'YYYY-MM-DD') */
  currentDate: string;

  tasks: Task[];
  calendarEntries: CalendarEntry[];
  recurrentTasks: RecurrentTask[];
  projects: Project[];
  tags: Tag[];
}
