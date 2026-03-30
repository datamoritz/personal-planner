'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskPill } from '@/components/ui/TaskPill';
import type { Task } from '@/types';

interface SortableTaskItemProps {
  task: Task;
  containerId: string;
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
      className="flex items-center gap-1 min-w-0"
      {...attributes}
      {...listeners}
    >
      <TaskPill task={task} className="flex-1 min-w-0" topLabel={topLabel} {...pillProps} />
      {suffix}
    </div>
  );
}
