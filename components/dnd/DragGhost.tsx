'use client';

import { RefreshCw } from 'lucide-react';
import type { Task, RecurrentTask } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';

/** Rendered inside DragOverlay — lightweight ghost that follows the cursor */

export function TaskGhost({ task, compact }: { task: Task; compact?: boolean }) {
  const tags = usePlannerStore((s) => s.tags);
  const tag = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  const isDone = task.status === 'done';
  const tagBg = !isDone && tag ? tag.colorDark + '24' : undefined;
  return (
    <div
      style={{
        background: tagBg,
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08)',
      }}
      className={[
        'flex items-center rounded-[1rem] bg-[var(--color-task-pill)] opacity-90 cursor-grabbing select-none max-w-xs',
        compact ? 'gap-1.5 px-2 py-1' : 'gap-2 px-2.5 py-2',
      ].join(' ')}
    >
      <div className={[
        'rounded-full border-2 border-[var(--color-text-muted)] flex-shrink-0',
        compact ? 'w-3 h-3' : 'w-[15px] h-[15px]',
      ].join(' ')} />
      <span className={[
        'text-[var(--color-text-primary)] truncate',
        compact ? 'text-[11px]' : 'text-[14px]',
      ].join(' ')}>{task.title}</span>
      {task.recurrentTaskId && (
        <RefreshCw size={compact ? 9 : 11} className="flex-shrink-0 text-[var(--color-accent)] opacity-70" strokeWidth={2.5} />
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
