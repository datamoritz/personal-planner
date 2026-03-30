'use client';

import { useSortable } from '@dnd-kit/sortable';
import { TimedTaskBlock } from '@/components/ui/TimedTaskBlock';
import type { Task } from '@/types';

interface SortableTimedTaskBlockProps {
  task: Task;
  style?: React.CSSProperties;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onToggle?: (id: string) => void;
  onResizeEnd?: (id: string, newEndTime: string) => void;
  onRepositionEnd?: (id: string, newStart: string, newEnd: string) => void;
}

export function SortableTimedTaskBlock(props: SortableTimedTaskBlockProps) {
  const { task } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', containerId: 'myday' },
  });

  return (
    <TimedTaskBlock
      {...props}
      nodeRef={setNodeRef}
      gripListeners={listeners}
      gripAttributes={attributes}
      isDraggingOut={isDragging}
    />
  );
}
