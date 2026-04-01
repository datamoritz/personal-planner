'use client';

import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type SensorDescriptor,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Moon, RefreshCw, Sun, Tag } from 'lucide-react';
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
import type { RecurrentTask, Task } from '@/types';

type ActiveDrag =
  | { type: 'task'; item: Task; compact?: boolean }
  | { type: 'recurrent'; item: RecurrentTask }
  | null;

const COLLAPSED_W = 32;

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
      <button onClick={onExpand} title="Expand panel" className="ui-icon-button">
        {direction === 'left'
          ? <ChevronRight size={14} strokeWidth={2} />
          : <ChevronLeft size={14} strokeWidth={2} />}
      </button>
    </div>
  );
}

interface PlannerAppViewProps {
  theme: 'light' | 'dark';
  viewMode: 'day' | 'week' | 'month' | 'year';
  setViewMode: (view: 'day' | 'week' | 'month' | 'year') => void;
  googleNeedsReconnect: boolean;
  handleRefresh: () => void;
  toggleTheme: () => void;
  activeTagFilter: string | null;
  activeTagName?: string;
  activeTagColorDark?: string;
  activeTagStyle: React.CSSProperties;
  tagsOpen: boolean;
  tagsAnchor: HTMLElement | null;
  setTagsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTagsAnchor: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  setLeftCollapsed: (value: boolean) => void;
  weekProjectsVisible: boolean;
  setWeekProjectsVisible: (value: boolean) => void;
  setRightCollapsed: (value: boolean) => void;
  triggerBacklogAdd: boolean;
  setTriggerBacklogAdd: (value: boolean) => void;
  focusMode: boolean;
  notesActionsVisible: boolean;
  setFocusMode: (value: boolean) => void;
  setNotesActionsVisible: (value: boolean) => void;
  activeDrag: ActiveDrag;
  sensors: SensorDescriptor<unknown>[];
  collisionDetection: CollisionDetection;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
}

export function PlannerAppView({
  theme,
  viewMode,
  setViewMode,
  googleNeedsReconnect,
  handleRefresh,
  toggleTheme,
  activeTagFilter,
  activeTagName,
  activeTagColorDark,
  activeTagStyle,
  tagsOpen,
  tagsAnchor,
  setTagsOpen,
  setTagsAnchor,
  leftCollapsed,
  rightCollapsed,
  setLeftCollapsed,
  weekProjectsVisible,
  setWeekProjectsVisible,
  setRightCollapsed,
  triggerBacklogAdd,
  setTriggerBacklogAdd,
  focusMode,
  notesActionsVisible,
  setFocusMode,
  setNotesActionsVisible,
  activeDrag,
  sensors,
  collisionDetection,
  handleDragStart,
  handleDragEnd,
}: PlannerAppViewProps) {
  const showLeftPanel = viewMode === 'week' ? weekProjectsVisible : !leftCollapsed;

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
                  title={activeTagFilter !== null ? activeTagName : 'Tags'}
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
                    color={activeTagFilter !== null ? activeTagColorDark : 'currentColor'}
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

          <div className="flex flex-col flex-1 rounded-[2rem] overflow-hidden border border-[var(--color-border)] bg-[var(--color-canvas)] ui-raised-surface min-w-0">
            <DayHeader />
            <div className="flex flex-1 min-h-0">
              {!focusMode && (
                <div style={{ width: showLeftPanel ? '23%' : COLLAPSED_W, flexShrink: 0 }} className="h-full min-w-0">
                  {showLeftPanel
                    ? (
                      <ProjectsColumn
                        onCollapse={() => {
                          if (viewMode === 'week') setWeekProjectsVisible(false);
                          else setLeftCollapsed(true);
                        }}
                        highlightSelection={notesActionsVisible}
                      />
                    )
                    : (
                      <CollapsedStrip
                        direction="left"
                        onExpand={() => {
                          if (viewMode === 'week') setWeekProjectsVisible(true);
                          else setLeftCollapsed(false);
                        }}
                      />
                    )}
                </div>
              )}

              {viewMode === 'week' ? (
                <div className="flex-1 min-w-0 min-h-0">
                  <WeekViewColumn
                    sidebarVisible={!rightCollapsed}
                    onNKey={() => setTriggerBacklogAdd(true)}
                  />
                </div>
              ) : (
                <>
                  <div
                    className="flex-[56] min-w-0 min-h-0 border-t-2 border-t-[var(--color-accent)]"
                    style={{ background: 'var(--color-center-col)', marginTop: '-2px' }}
                  >
                    <MyDayColumn onFocusMode={setFocusMode} onActionsMode={setNotesActionsVisible} />
                  </div>
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

              {!focusMode && (
                <div
                  style={{ width: rightCollapsed ? COLLAPSED_W : '23%', flexShrink: 0 }}
                  className={[
                    'h-full min-w-0 bg-[var(--color-canvas)]',
                    viewMode === 'week' ? 'border-l border-[var(--color-border)]' : '',
                  ].join(' ')}
                >
                  {rightCollapsed
                    ? <CollapsedStrip direction="right" onExpand={() => setRightCollapsed(false)} />
                    : (
                      <SidebarColumn
                        onCollapse={() => setRightCollapsed(true)}
                        triggerBacklogAdd={triggerBacklogAdd}
                        onBacklogAddHandled={() => setTriggerBacklogAdd(false)}
                      />
                    )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'task' && <TaskGhost task={activeDrag.item} compact={activeDrag.compact} />}
          {activeDrag?.type === 'recurrent' && <RecurrentGhost task={activeDrag.item} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
