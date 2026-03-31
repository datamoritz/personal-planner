'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskPill } from '@/components/ui/TaskPill';
import type { Task } from '@/types';

interface SortableTaskItemProps {
  task: Task;
  containerId: string;
  noHover?: boolean;
  isOverdue?: boolean;
  showRecurrenceIcon?: boolean;
  topLabel?: string;
  onToggle?: (id: string) => void;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  className?: string;
  suffix?: React.ReactNode;
}

export function SortableTaskItem({
  task,
  containerId,
  noHover = false,
  suffix,
  topLabel,
  ...pillProps
}: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', containerId },
  });

return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      /* Add dynamic classes here */
      className={[
        "flex items-center gap-1 min-w-0 rounded-xl transition-colors",
        !noHover 
          ? "hover:bg-[var(--color-surface-raised)] cursor-pointer" 
          : "cursor-default"
      ].join(' ')}
      {...attributes}
      {...listeners}
    >
      <TaskPill 
        task={task} 
        className="flex-1 min-w-0" 
        topLabel={topLabel} 
        /* Pass noHover to the pill if the pill also has hover styles */
        noHover={noHover} 
        {...pillProps} 
      />
      {suffix}
    </div>
  );
}