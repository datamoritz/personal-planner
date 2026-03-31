'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { addDays, format } from 'date-fns';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { usePlannerData } from '@/lib/usePlannerData';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { ImportBanner } from './ImportBanner';
import { DayHeader } from './DayHeader';
import { ProjectsColumn } from './columns/ProjectsColumn';
import { MyDayColumn } from './columns/MyDayColumn';
import { TasksTodayColumn } from './columns/TasksTodayColumn';
import { SidebarColumn } from './columns/SidebarColumn';
import { WeekViewColumn } from './columns/WeekViewColumn';
import { TaskGhost, RecurrentGhost } from './dnd/DragGhost';
import type { Task, RecurrentTask } from '@/types';

type ActiveDrag =
  | { type: 'task'; item: Task; compact?: boolean }
  | { type: 'recurrent'; item: RecurrentTask }
  | null;

const REORDERABLE_CONTAINERS = new Set(['today', 'backlog']);

/**
 * When the dragged item's center is geometrically inside a week-cal-* droppable,
 * return it immediately. Checked against both pointerCoordinates (most accurate)
 * and the translated drag rect center (fallback). Otherwise falls back to
 * closestCenter for all other drops.
 *
 * This is needed because closestCenter compares center distances, and the task
 * strip directly below the calendar always wins over the tall calendar column
 * when dragging upward from the task section.
 */
function weekAwareCollisionDetection(args: Parameters<CollisionDetection>[0]) {
  const { active, pointerCoordinates, droppableRects, droppableContainers } = args;

  // Prefer pointer coordinates; fall back to translated drag-rect center
  const translated = active?.rect.current.translated;
  const px = pointerCoordinates?.x ?? (translated ? translated.left + translated.width  / 2 : null);
  const py = pointerCoordinates?.y ?? (translated ? translated.top  + translated.height / 2 : null);

  if (px !== null && py !== null) {
    for (const container of droppableContainers) {
      if (!String(container.id).startsWith('week-cal-')) continue;
      const rect = droppableRects.get(container.id);
      if (!rect) continue;
      if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) {
        return [{ id: container.id }];
      }
    }
  }
  return closestCenter(args);
}
const COLLAPSED_W = 32; // px — collapsed strip width

function CollapsedStrip({
  direction,
  onExpand,
}: {
  direction: 'left' | 'right';
  onExpand: () => void;
}) {
  return (
    <div
      className={[
        'flex flex-col items-center pt-3 h-full',
        direction === 'left'
          ? 'border-r border-[var(--color-border)]'
          : 'border-l border-[var(--color-border)]',
      ].join(' ')}
    >
      <button
        onClick={onExpand}
        title="Expand panel"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] transition-colors cursor-pointer"
      >
        {direction === 'left'
          ? <ChevronRight size={14} strokeWidth={2} />
          : <ChevronLeft  size={14} strokeWidth={2} />}
      </button>
    </div>
  );
}

export function PlannerApp() {
  const theme = usePlannerStore((s) => s.theme);
  const { isLoading, error, legacyData } = usePlannerData();
  const viewMode = usePlannerStore((s) => s.viewMode);
  const { currentDate, tasks, recurrentTasks, reorderTask, moveTask, spawnRecurrentInstance } =
    usePlannerStore();

  const { refresh: refreshGoogle } = useGoogleCalendar();

  const [activeDrag, setActiveDrag]         = useState<ActiveDrag>(null);
  const [leftCollapsed, setLeftCollapsed]   = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [triggerBacklogAdd, setTriggerBacklogAdd] = useState(false);
  const [focusMode, setFocusMode]           = useState(false);
  const [notesActionsVisible, setNotesActionsVisible] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => weekAwareCollisionDetection(args),
    [],
  );

  function handleDragStart({ active }: DragStartEvent) {
    const data = active.data.current as { type: string; containerId: string } | undefined;
    if (data?.type === 'recurrent') {
      const item = recurrentTasks.find((r) => r.id === active.id);
      if (item) setActiveDrag({ type: 'recurrent', item });
    } else {
      const item = tasks.find((t) => t.id === active.id);
      const compact = data?.containerId?.startsWith('week-today-') ?? false;
      if (item) setActiveDrag({ type: 'task', item, compact });
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDrag(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId   = String(over.id);
    const sourceData = active.data.current as { type: string; containerId: string } | undefined;
    const overData   = over.data.current   as { type: string; containerId: string } | undefined;

    const sourceContainer = sourceData?.containerId ?? '';
    const destContainer   = overData?.containerId ?? overId.replace(/^drop-/, '');

    if (sourceContainer === 'recurrent') {
      if (destContainer === 'today') {
        spawnRecurrentInstance(activeId, { location: 'today', date: currentDate });
      } else if (destContainer === 'backlog') {
        spawnRecurrentInstance(activeId, { location: 'backlog' });
      }
      return;
    }

    if (sourceContainer === destContainer) {
      const canReorder =
        REORDERABLE_CONTAINERS.has(sourceContainer) ||
        sourceContainer.startsWith('project-') ||
        sourceContainer.startsWith('week-today-');
      if (canReorder && activeId !== overId) reorderTask(activeId, overId);
      return;
    }

    if (destContainer === 'week-cal') return; // handled by WeekViewColumn useDndMonitor

    const tomorrow = format(addDays(new Date(currentDate + 'T00:00:00'), 1), 'yyyy-MM-dd');

    if (destContainer === 'today') {
      moveTask(activeId, { location: 'today', date: currentDate });
    } else if (destContainer === 'backlog') {
      moveTask(activeId, { location: 'backlog', date: undefined });
    } else if (destContainer === 'upcoming') {
      const task = tasks.find((t) => t.id === activeId);
      const keepDate = task?.date && task.date > currentDate ? task.date : tomorrow;
      moveTask(activeId, { location: 'upcoming', date: keepDate });
    } else if (destContainer.startsWith('project-')) {
      const projectId = destContainer.replace('project-', '');
      moveTask(activeId, { location: 'project', projectId, date: undefined });
    } else if (destContainer.startsWith('week-today-')) {
      const date = destContainer.replace('week-today-', '');
      moveTask(activeId, { location: 'today', date });
    }
  }

  if (isLoading || error) {
    return (
      <div data-theme={theme} className="flex h-full items-center justify-center bg-[var(--color-background)]">
        {error
          ? <p className="text-sm text-red-500">{error}</p>
          : <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        }
      </div>
    );
  }

  if (legacyData) {
    return <ImportBanner legacyData={legacyData} theme={theme} />;
  }

  return (
    <div data-theme={theme} className="flex h-full p-7 bg-[var(--color-background)]">
      <DndContext
        id="planner-dnd"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Floating canvas */}
        <div className="flex flex-col flex-1 rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-canvas)] shadow-2xl min-w-0">
          <DayHeader onRefreshGoogle={refreshGoogle} />

          <div className="flex flex-1 min-h-0">
            {/* ── Left panel — Projects ──────────────────────────── */}
            {!focusMode && (
              <div
                style={{ width: leftCollapsed ? COLLAPSED_W : '23%', flexShrink: 0 }}
                className="h-full min-w-0"
              >
                {leftCollapsed
                  ? <CollapsedStrip direction="left" onExpand={() => setLeftCollapsed(false)} />
                  : <ProjectsColumn onCollapse={() => setLeftCollapsed(true)} highlightSelection={notesActionsVisible} />
                }
              </div>
            )}

            {/* ── Center ────────────────────────────────────────── */}
            {viewMode === 'week' ? (
              <div className="flex-1 min-w-0 min-h-0">
                <WeekViewColumn
                  sidebarVisible={!rightCollapsed}
                  onNKey={() => setTriggerBacklogAdd(true)}
                />
              </div>
            ) : (
              <>
                {/* My Day */}
                <div
                  className="flex-[56] min-w-0 min-h-0 border-t-2 border-t-[var(--color-accent)]"
                  style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
                >
                  <MyDayColumn onFocusMode={setFocusMode} onActionsMode={setNotesActionsVisible} />
                </div>
                {/* Tasks Today */}
                {!focusMode && (
                  <div
                    className="flex-[44] min-w-0 min-h-0 border-t-2 border-t-[var(--color-accent)]"
                    style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
                  >
                    <TasksTodayColumn />
                  </div>
                )}
              </>
            )}

            {/* ── Right panel — Sidebar ─────────────────────────── */}
            {!focusMode && (
              <div
                style={{ width: rightCollapsed ? COLLAPSED_W : '23%', flexShrink: 0 }}
                className="h-full min-w-0"
              >
                {rightCollapsed
                  ? <CollapsedStrip direction="right" onExpand={() => setRightCollapsed(false)} />
                  : <SidebarColumn
                      onCollapse={() => setRightCollapsed(true)}
                      triggerBacklogAdd={triggerBacklogAdd}
                      onBacklogAddHandled={() => setTriggerBacklogAdd(false)}
                    />
                }
              </div>
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'task'      && <TaskGhost      task={activeDrag.item} compact={activeDrag.compact} />}
          {activeDrag?.type === 'recurrent' && <RecurrentGhost task={activeDrag.item} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
