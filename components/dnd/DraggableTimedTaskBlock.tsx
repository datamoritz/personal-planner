'use client';

import { useDraggable } from '@dnd-kit/core';
import { TimedTaskBlock } from '@/components/ui/TimedTaskBlock';
import type { Task } from '@/types';

interface DraggableTimedTaskBlockProps {
  task: Task;
  style?: React.CSSProperties;
  compact?: boolean;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onToggle?: (id: string) => void;
  onResizeEnd?: (id: string, newEndTime: string) => void;
  onRepositionEnd?: (id: string, newStart: string, newEnd: string) => void;
  verticalOnly?: boolean;
}

export function DraggableTimedTaskBlock(props: DraggableTimedTaskBlockProps) {
  const { task } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
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
      verticalOnly={props.verticalOnly}
    />
  );
}
