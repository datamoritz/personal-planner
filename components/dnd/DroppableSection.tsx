'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

interface DroppableSectionProps {
  containerId: string;
  itemIds: string[];
  children: React.ReactNode;
  className?: string;
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Combines useDroppable (for empty-list drops) + SortableContext (for sortable items).
 * The droppable id is `drop-{containerId}` so it doesn't clash with item ids.
 */
export function DroppableSection({
  containerId,
  itemIds,
  children,
  className = '',
  onDoubleClick,
}: DroppableSectionProps) {
  const { setNodeRef } = useDroppable({
    id: `drop-${containerId}`,
    data: { type: 'container', containerId },
  });

  return (
    <div ref={setNodeRef} className={className} onDoubleClick={onDoubleClick}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}
