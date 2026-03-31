'use client';

import { RefreshCw } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { Task } from '@/types';

interface TaskPillProps {
  task: Task;
  isOverdue?: boolean;
  showRecurrenceIcon?: boolean;
  noHover?: boolean;
  topLabel?: string;       // small label shown above title inside the pill (e.g. date for upcoming)
  onToggle?: (id: string) => void;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  className?: string;
}

export function TaskPill({
  task,
  isOverdue = false,
  showRecurrenceIcon = false,
  topLabel,
  noHover = false,
  onToggle,
  onDoubleClick,
  className = '',
}: TaskPillProps) {
  const isDone = task.status === 'done';
  const tags = usePlannerStore((s) => s.tags);
  const tag = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;

  // Use colorDark at low opacity so the tint works on both dark and light backgrounds
  const tagBg = (!isDone && !isOverdue && tag) ? tag.colorDark + '33' : undefined;

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.(task.id, e.currentTarget);
      }}
      style={{
        boxShadow: isDone ? 'none' : 'var(--shadow-card)',
        background: tagBg,
      }}
      className={[
        `item-enter group flex items-center gap-2.5 px-3 ${topLabel ? 'py-1.5' : 'py-2.5'} rounded-full cursor-pointer select-none`,
        'transition-all duration-150',
        isDone
          ? 'bg-[var(--color-surface)] opacity-50'
          : isOverdue
          ? 'bg-[var(--color-overdue-subtle)]'
          : tag
          ? ''
          : 'bg-[var(--color-surface)]',
        className,
      ].join(' ')}
    >
      {/* Completion circle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          (e.currentTarget as HTMLElement).classList.add('check-pop');
          onToggle?.(task.id);
        }}
        className={[
          'flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer',
          isDone
            ? 'bg-[var(--color-done)] border-[var(--color-done)]'
            : isOverdue
            ? 'border-[var(--color-overdue)]'
            : 'border-[var(--color-text-muted)]',
        ].join(' ')}
      >
        {isDone && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <span className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {topLabel && (
          <span className="text-[9px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide leading-none mb-0.5">
            {topLabel}
          </span>
        )}
        <span
          className={[
            'text-sm leading-tight truncate',
            isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          {task.title}
        </span>
      </span>

      {showRecurrenceIcon && (
        <RefreshCw size={11} className="flex-shrink-0 text-[var(--color-accent)] opacity-70" strokeWidth={2.5} />
      )}
    </div>
  );
}
