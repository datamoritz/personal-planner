'use client';

import { RefreshCw } from 'lucide-react';
import type { Task, RecurrentTask } from '@/types';

/** Rendered inside DragOverlay — lightweight ghost that follows the cursor */

export function TaskGhost({ task, compact }: { task: Task; compact?: boolean }) {
  return (
    <div className={[
      'flex items-center rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] shadow-xl opacity-90 cursor-grabbing select-none max-w-xs',
      compact ? 'gap-1 px-1.5 py-0.5' : 'gap-2.5 px-3 py-2',
    ].join(' ')}>
      <div className={[
        'rounded-full border-2 border-[var(--color-accent)] flex-shrink-0',
        compact ? 'w-3 h-3' : 'w-4 h-4',
      ].join(' ')} />
      <span className={[
        'text-[var(--color-text-primary)] truncate',
        compact ? 'text-[11px]' : 'text-sm',
      ].join(' ')}>{task.title}</span>
      {task.recurrentTaskId && (
        <RefreshCw size={compact ? 9 : 11} className="flex-shrink-0 text-[var(--color-accent)]" strokeWidth={2.5} />
      )}
    </div>
  );
}

export function RecurrentGhost({ task }: { task: RecurrentTask }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] shadow-xl opacity-90 cursor-grabbing select-none max-w-xs">
      <RefreshCw size={12} className="flex-shrink-0 text-[var(--color-accent)]" strokeWidth={2.5} />
      <span className="text-sm text-[var(--color-text-primary)] truncate">{task.title}</span>
    </div>
  );
}
