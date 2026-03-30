'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RecurrentTaskPill } from '@/components/ui/RecurrentTaskPill';
import type { RecurrentTask } from '@/types';

interface SortableRecurrentItemProps {
  task: RecurrentTask;
  hasActiveInstance?: boolean;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
}

export function SortableRecurrentItem({ task, hasActiveInstance, onDoubleClick }: SortableRecurrentItemProps) {
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
      <RecurrentTaskPill task={task} hasActiveInstance={hasActiveInstance} onDoubleClick={onDoubleClick} />
    </div>
  );
}
