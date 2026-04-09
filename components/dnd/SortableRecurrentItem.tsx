'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RecurrentTaskPill } from '@/components/ui/RecurrentTaskPill';
import type { RecurrentTask } from '@/types';

interface SortableRecurrentItemProps {
  task: RecurrentTask;
  isCompleted?: boolean;
  accentColor?: string;
  accentColorDark?: string;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onToggle?: (id: string) => void;
}

export function SortableRecurrentItem({
  task,
  isCompleted,
  accentColor,
  accentColorDark,
  onDoubleClick,
  onToggle,
}: SortableRecurrentItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'recurrent', containerId: 'recurrent' },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <RecurrentTaskPill
        task={task}
        isCompleted={isCompleted}
        accentColor={accentColor}
        accentColorDark={accentColorDark}
        onDoubleClick={onDoubleClick}
        onToggle={onToggle}
      />
    </div>
  );
}
