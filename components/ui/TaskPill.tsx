'use client';

import type { ReactNode } from 'react';
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
  rightAdornment?: ReactNode;
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
  rightAdornment,
  className = '',
}: TaskPillProps) {
  const isDone = task.status === 'done';
  const tags = usePlannerStore((s) => s.tags);
  const tag = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  // Use colorDark at low opacity so the tint works on both dark and light backgrounds
  const tagBg = (!isDone && !isOverdue && tag) ? tag.colorDark + '24' : undefined;
  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.(task.id, e.currentTarget);
      }}
      style={{
        boxShadow: isDone ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.03), 0 10px 22px rgba(15, 23, 42, 0.038)',
        background: tagBg,
      }}
      className={[
        `item-enter group flex items-center gap-2 px-2.5 ${topLabel ? 'py-1.5' : 'py-2'} rounded-[1rem] cursor-pointer select-none border`,
        'transition-all duration-150',
        noHover ? '' : 'hover:-translate-y-px',
        isDone
          ? 'bg-[var(--color-task-pill)] border-[var(--color-task-pill-border)] opacity-50'
          : isOverdue
          ? 'bg-[var(--color-overdue-subtle)] border-transparent'
          : tag
          ? 'border-transparent'
          : 'bg-[var(--color-task-pill)] border-[var(--color-task-pill-border)]',
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
          'flex-shrink-0 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer',
          isDone
            ? 'bg-[var(--color-done)] border-[var(--color-done)] opacity-65'
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
          <span className="text-[9px] font-medium text-[var(--color-text-muted)] tracking-[0.03em] leading-none mb-0.5">
            {topLabel}
          </span>
        )}
        <span
          className={[
            'text-[14px] leading-tight truncate',
            isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          {task.title}
        </span>
      </span>

      {(showRecurrenceIcon || rightAdornment) && (
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {showRecurrenceIcon && (
            <RefreshCw size={11} className="text-[var(--color-accent)] opacity-70" strokeWidth={2.5} />
          )}
          {rightAdornment}
        </span>
      )}
    </div>
  );
}
