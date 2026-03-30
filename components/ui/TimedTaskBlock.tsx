'use client';

import { useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { Task } from '@/types';
import { usePlannerStore } from '@/store/usePlannerStore';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToTime,
  snapTo15Min,
} from '@/lib/timeGrid';

interface TimedTaskBlockProps {
  task: Task;
  style?: React.CSSProperties;
  compact?: boolean;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onToggle?: (id: string) => void;
  onResizeEnd?: (id: string, newEndTime: string) => void;
  onRepositionEnd?: (id: string, newStartTime: string, newEndTime: string, pos?: { x: number; y: number }) => void;
  verticalOnly?: boolean;
  // Passed from SortableTimedTaskBlock for cross-column dnd-kit dragging
  nodeRef?: (el: HTMLDivElement | null) => void;
  gripListeners?: SyntheticListenerMap | undefined;
  gripAttributes?: DraggableAttributes;
  isDraggingOut?: boolean;
}

export function TimedTaskBlock({
  task,
  style,
  compact = false,
  onDoubleClick,
  onToggle,
  onResizeEnd,
  onRepositionEnd,
  verticalOnly = false,
  nodeRef,
  gripListeners,
  gripAttributes,
  isDraggingOut = false,
}: TimedTaskBlockProps) {
  const isDone   = task.status === 'done';
  const tags     = usePlannerStore((s) => s.tags);
  const tag      = task.tagId ? tags.find((t) => t.id === task.tagId) : undefined;
  const tagBg    = (!isDone && tag) ? tag.color + 'CC' : undefined;
  const blockRef = useRef<HTMLDivElement>(null);
  // Track whether current pointer-down originated on the grip (skip grid reposition)
  const gripActive = useRef(false);

  const combinedRef = useCallback((el: HTMLDivElement | null) => {
    (blockRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    nodeRef?.(el);
  }, [nodeRef]);

  // ── Drag to reposition on grid ──────────────────────────────────────────
  const handleDragPointerDown = (e: React.PointerEvent) => {
    if (gripActive.current) return; // grip takes over for dnd-kit
    if (!onRepositionEnd || !task.startTime || !task.endTime) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();

    const captureTarget = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);

    const startY    = e.clientY;
    const startX    = e.clientX;
    const initTop   = blockRef.current!.offsetTop;
    const duration  = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
    let currentTop  = initTop;
    let hasMoved    = false;

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      if (Math.abs(dy) > 4 || Math.abs(dx) > 4) hasMoved = true;
      if (!hasMoved) return;
      currentTop = Math.max(0, initTop + dy);
      if (blockRef.current) {
        blockRef.current.style.top     = `${currentTop}px`;
        blockRef.current.style.zIndex  = '30';
        blockRef.current.style.opacity = '0.85';
        blockRef.current.style.cursor  = 'grabbing';
      }
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      captureTarget.releasePointerCapture(e.pointerId);
      if (hasMoved) {
        if (blockRef.current) {
          blockRef.current.style.top     = '';
          blockRef.current.style.zIndex  = '';
          blockRef.current.style.opacity = '';
          blockRef.current.style.cursor  = '';
        }
        const raw       = (currentTop / SLOT_HEIGHT) * 60;
        const startMins = Math.max(0, Math.min(snapTo15Min(raw), END_HOUR * 60 - duration));
        const pos       = verticalOnly ? undefined : { x: ev.clientX, y: ev.clientY };
        onRepositionEnd(task.id, minutesToTime(startMins), minutesToTime(startMins + duration), pos);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Resize handle ───────────────────────────────────────────────────────
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!task.startTime || !task.endTime) return;
    e.preventDefault();
    e.stopPropagation();

    const captureTarget  = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);

    const startY         = e.clientY;
    const initialEndMins = timeToMinutes(task.endTime);
    const startMins      = timeToMinutes(task.startTime);
    const initialHeight  = blockRef.current?.getBoundingClientRect().height ?? 0;
    let liveHeight       = initialHeight;

    const onMove = (ev: PointerEvent) => {
      const dy   = ev.clientY - startY;
      liveHeight = Math.max(initialHeight + dy, SLOT_HEIGHT / 4);
      if (blockRef.current) blockRef.current.style.height = `${liveHeight}px`;
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      captureTarget.releasePointerCapture(ev.pointerId);
      if (blockRef.current) blockRef.current.style.height = '';
      const deltaMins = ((liveHeight - initialHeight) / SLOT_HEIGHT) * 60;
      const snapped   = snapTo15Min(initialEndMins + deltaMins);
      const finalMins = Math.max(startMins + 15, Math.min(snapped, END_HOUR * 60));
      onResizeEnd?.(task.id, minutesToTime(finalMins));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={combinedRef}
      onPointerDown={handleDragPointerDown}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(task.id, e.currentTarget); }}
      style={{ ...style, opacity: isDraggingOut ? 0.35 : style?.opacity, boxShadow: isDone ? 'none' : 'var(--shadow-card)', background: tagBg }}
      className={[
        `absolute left-1 right-1 rounded-2xl ${compact ? 'px-1.5 py-1' : 'px-2.5 py-1.5'} select-none overflow-hidden group`,
        'transition-colors',
        isDone
          ? 'bg-[var(--color-surface)] opacity-50'
          : tag ? '' : 'bg-[var(--color-surface)]',
        onRepositionEnd && task.startTime ? 'cursor-grab' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* dnd-kit grip handle (cross-column dragging) */}
      {gripListeners && (
        <div
          {...(gripAttributes as React.HTMLAttributes<HTMLDivElement>)}
          {...(gripListeners as React.HTMLAttributes<HTMLDivElement>)}
          onPointerDown={(e) => {
            gripActive.current = true;
            // call the dnd-kit listener
            (gripListeners as Record<string, (e: React.PointerEvent) => void>).onPointerDown?.(e);
            const reset = () => { gripActive.current = false; };
            window.addEventListener('pointerup', reset, { once: true });
          }}
          className="absolute top-1 right-1.5 p-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-grab z-20 touch-none"
          title="Drag to another column"
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" className="text-[var(--color-text-muted)]">
            <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
            <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
            <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
          </svg>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggle?.(task.id); }}
          className={[
            `flex-shrink-0 ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer`,
            isDone
              ? 'bg-[var(--color-done)] border-[var(--color-done)]'
              : 'border-[var(--color-text-muted)] hover:border-[var(--color-accent)]',
          ].join(' ')}
        >
          {isDone && (
            <svg width="6" height="5" viewBox="0 0 6 5" fill="none">
              <path d="M1 2.5L2.5 4L5 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span className={[
          `flex-1 ${compact ? 'text-[10px]' : 'text-xs'} font-medium leading-tight truncate`,
          isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]',
        ].join(' ')}>
          {task.title}
        </span>
        {task.recurrentTaskId && (
          <RefreshCw size={9} className="flex-shrink-0 text-[var(--color-accent)] opacity-70" strokeWidth={2.5} />
        )}
      </div>

      {task.startTime && (
        <p className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-[var(--color-text-secondary)] mt-0.5 ml-5`}>
          {task.startTime} – {task.endTime}
        </p>
      )}

      {onResizeEnd && task.startTime && (
        <div
          onPointerDown={handleResizePointerDown}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-row-resize flex items-center justify-center"
        >
          <div className="w-6 h-0.5 rounded-full bg-[var(--color-border)] opacity-60 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  );
}
