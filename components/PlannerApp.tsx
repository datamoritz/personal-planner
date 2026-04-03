'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { addDays, format } from 'date-fns';
import { usePlannerStore } from '@/store/usePlannerStore';
import { usePlannerData } from '@/lib/usePlannerData';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import type { Task, RecurrentTask } from '@/types';
import { PlannerAppView } from './PlannerAppView';

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

  // 1. week-cal columns: always use exact pointer containment (unchanged)
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

  // 2. For all other drops: pointer-within first so sidebar→center drops register
  //    on whichever droppable the pointer is physically over, not the nearest center.
  const within = pointerWithin(args);
  if (within.length > 0) return within;

  return closestCenter(args);
}
export function PlannerApp() {
  const theme = usePlannerStore((s) => s.theme);
  const toggleTheme = usePlannerStore((s) => s.toggleTheme);
  const viewMode = usePlannerStore((s) => s.viewMode);
  const monthViewMode = usePlannerStore((s) => s.monthViewMode);
  const setViewMode = usePlannerStore((s) => s.setViewMode);
  const googleNeedsReconnect = usePlannerStore((s) => s.googleNeedsReconnect);
  const tags = usePlannerStore((s) => s.tags);
  const activeTagFilter = usePlannerStore((s) => s.activeTagFilter);
  const { isLoading, error, refresh: refreshPlanner } = usePlannerData();
  const { currentDate, tasks, recurrentTasks, reorderTask, reorderProject, moveTask, spawnRecurrentInstance, deleteTask } =
    usePlannerStore();

  const { refresh: refreshGoogle } = useGoogleCalendar();
  const handleRefresh = useCallback(() => { refreshPlanner(); refreshGoogle(); }, [refreshPlanner, refreshGoogle]);

  const [activeDrag, setActiveDrag]         = useState<ActiveDrag>(null);
  const [leftCollapsed, setLeftCollapsed]   = useState(false);
  const [weekProjectsVisible, setWeekProjectsVisible] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [triggerBacklogAdd, setTriggerBacklogAdd] = useState(false);
  const [focusMode, setFocusMode]           = useState(false);
  const [notesActionsVisible, setNotesActionsVisible] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsAnchor, setTagsAnchor] = useState<HTMLElement | null>(null);

  const activeTag = tags.find((t) => t.id === activeTagFilter);
  const activeTagStyle = activeTag ? {
    backgroundColor: activeTag.color,
    color: activeTag.colorDark,
    borderColor: activeTag.colorDark,
  } : {};

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [theme]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => weekAwareCollisionDetection(args),
    [],
  );

  function handleDragStart({ active }: DragStartEvent) {
    const data = active.data.current as { type: string; containerId: string } | undefined;
    if (data?.type === 'project') {
      setActiveDrag(null);
      return;
    }
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

    if (sourceData?.type === 'project') {
      if (activeId !== overId) reorderProject(activeId, overId);
      return;
    }

    if (sourceContainer === 'recurrent') {
      if (destContainer === 'today') {
        spawnRecurrentInstance(activeId, { location: 'today', date: currentDate });
      } else if (destContainer === 'backlog') {
        spawnRecurrentInstance(activeId, { location: 'backlog' });
      } else if (destContainer.startsWith('week-today-')) {
        const date = destContainer.replace('week-today-', '');
        spawnRecurrentInstance(activeId, { location: 'today', date });
      } else if (destContainer.startsWith('month-day-')) {
        const date = destContainer.replace('month-day-', '');
        spawnRecurrentInstance(activeId, { location: 'today', date });
      }
      return;
    }

    if (sourceContainer === destContainer) {
      const canReorder =
        REORDERABLE_CONTAINERS.has(sourceContainer) ||
        sourceContainer.startsWith('project-') ||
        sourceContainer.startsWith('week-today-') ||
        sourceContainer.startsWith('month-day-');
      if (canReorder && activeId !== overId) reorderTask(activeId, overId);
      return;
    }

    if (destContainer === 'week-cal') return; // handled by WeekViewColumn useDndMonitor
    if (destContainer === 'trash') {
      deleteTask(activeId);
      return;
    }

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
    } else if (destContainer.startsWith('month-day-')) {
      const date = destContainer.replace('month-day-', '');
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

  return (
    <PlannerAppView
      theme={theme}
      viewMode={viewMode}
      monthViewMode={monthViewMode}
      setViewMode={setViewMode}
      googleNeedsReconnect={googleNeedsReconnect}
      handleRefresh={handleRefresh}
      toggleTheme={toggleTheme}
      activeTagFilter={activeTagFilter}
      activeTagName={activeTag?.name}
      activeTagColorDark={activeTag?.colorDark}
      activeTagStyle={activeTagStyle}
      tagsOpen={tagsOpen}
      tagsAnchor={tagsAnchor}
      setTagsOpen={setTagsOpen}
      setTagsAnchor={setTagsAnchor}
      leftCollapsed={leftCollapsed}
      rightCollapsed={rightCollapsed}
      setLeftCollapsed={setLeftCollapsed}
      weekProjectsVisible={weekProjectsVisible}
      setWeekProjectsVisible={setWeekProjectsVisible}
      setRightCollapsed={setRightCollapsed}
      triggerBacklogAdd={triggerBacklogAdd}
      setTriggerBacklogAdd={setTriggerBacklogAdd}
      focusMode={focusMode}
      notesActionsVisible={notesActionsVisible}
      setFocusMode={setFocusMode}
      setNotesActionsVisible={setNotesActionsVisible}
      activeDrag={activeDrag}
      sensors={sensors}
      collisionDetection={collisionDetection}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
    />
  );
}
