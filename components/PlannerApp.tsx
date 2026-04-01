'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
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
import { ChevronRight, ChevronLeft, Moon, RefreshCw, Sun, Tag } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { usePlannerData } from '@/lib/usePlannerData';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { DayHeader } from './DayHeader';
import { ProjectsColumn } from './columns/ProjectsColumn';
import { MyDayColumn } from './columns/MyDayColumn';
import { TasksTodayColumn } from './columns/TasksTodayColumn';
import { SidebarColumn } from './columns/SidebarColumn';
import { WeekViewColumn } from './columns/WeekViewColumn';
import { ViewToggle } from './ui/ViewToggle';
import { TagsDropdown } from './ui/TagsDropdown';
import { DetailPopover } from './ui/DetailPopover';
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
        'flex flex-col items-center pt-4 h-full',
        direction === 'left'
          ? 'border-r border-[var(--color-border)]'
          : 'border-l border-[var(--color-border)]',
      ].join(' ')}
    >
      <button
        onClick={onExpand}
        title="Expand panel"
        className="ui-icon-button"
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
  const toggleTheme = usePlannerStore((s) => s.toggleTheme);
  const viewMode = usePlannerStore((s) => s.viewMode);
  const setViewMode = usePlannerStore((s) => s.setViewMode);
  const googleNeedsReconnect = usePlannerStore((s) => s.googleNeedsReconnect);
  const tags = usePlannerStore((s) => s.tags);
  const activeTagFilter = usePlannerStore((s) => s.activeTagFilter);
  const { isLoading, error, refresh: refreshPlanner } = usePlannerData();
  const { currentDate, tasks, recurrentTasks, reorderTask, moveTask, spawnRecurrentInstance } =
    usePlannerStore();

  const { refresh: refreshGoogle } = useGoogleCalendar();
  const handleRefresh = useCallback(() => { refreshPlanner(); refreshGoogle(); }, [refreshPlanner, refreshGoogle]);

  const [activeDrag, setActiveDrag]         = useState<ActiveDrag>(null);
  const [leftCollapsed, setLeftCollapsed]   = useState(false);
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

  return (
    <div data-theme={theme} className="flex h-full bg-[var(--color-background)] px-7 pb-7 pt-4 xl:px-9 xl:pb-9 xl:pt-5">
      <DndContext
        id="planner-dnd"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col flex-1 max-w-[1920px] mx-auto min-w-0">
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-3.5">
              <span className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)] flex-shrink-0">
                Planner
              </span>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative inline-flex">
                <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagsAnchor(e.currentTarget);
                      setTagsOpen((v) => !v);
                    }}
                  style={activeTagFilter !== null ? activeTagStyle : {}}
                  title={activeTagFilter !== null ? activeTag?.name : 'Tags'}
                  className={[
                    'ui-icon-button',
                    activeTagFilter === null
                      ? 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10'
                      : '',
                  ].join(' ')}
                >
                  <Tag
                    size={14}
                    strokeWidth={2.25}
                    color={activeTagFilter !== null ? activeTag?.colorDark : 'currentColor'}
                  />
                </button>
                {tagsOpen && tagsAnchor && (
                  <DetailPopover anchor={tagsAnchor} onClose={() => setTagsOpen(false)} className="w-[212px]" noPadding hideCloseButton>
                    <TagsDropdown onClose={() => setTagsOpen(false)} />
                  </DetailPopover>
                )}
              </div>
              {googleNeedsReconnect ? (
                <button
                  onClick={() => window.open('https://planner-api.moritzknodler.com/auth/google/login', '_blank')}
                  title="Reconnect Google Calendar"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-700 bg-white/55 border border-amber-200/80 hover:bg-white/70 dark:bg-amber-900/18 dark:border-amber-700/35 dark:text-amber-300 transition-colors cursor-pointer"
                >
                  <RefreshCw size={11} strokeWidth={2.5} />
                  Reconnect
                </button>
              ) : (
                <button
                  onClick={handleRefresh}
                  title="Refresh"
                  className="ui-icon-button text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <RefreshCw size={14} strokeWidth={2} />
                </button>
              )}
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="ui-icon-button text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              >
                {theme === 'dark' ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
              </button>
            </div>
          </div>

          {/* Floating canvas */}
          <div className="flex flex-col flex-1 rounded-[2rem] overflow-hidden border border-[var(--color-border)] bg-[var(--color-canvas)] ui-raised-surface min-w-0">
            <DayHeader />
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
                className="h-full min-w-0 bg-[var(--color-canvas)]"
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
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'task'      && <TaskGhost      task={activeDrag.item} compact={activeDrag.compact} />}
          {activeDrag?.type === 'recurrent' && <RecurrentGhost task={activeDrag.item} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
