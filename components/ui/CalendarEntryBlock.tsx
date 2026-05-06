'use client';

import { useRef } from 'react';
import {
  END_HOUR,
  SLOT_HEIGHT,
  timeToMinutes,
  minutesToTime,
  snapTo15Min,
} from '@/lib/timeGrid';
import { useSlotHeight } from '@/lib/slotHeightContext';

interface CalendarEntryLike {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
}

interface CalendarEntryBlockProps {
  entry: CalendarEntryLike;
  style?: React.CSSProperties;
  compact?: boolean;
  readOnly?: boolean;
  onDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onResizeEnd?: (id: string, newEndTime: string) => void;
  onRepositionEnd?: (id: string, newStartTime: string, newEndTime: string, pos?: { x: number; y: number }) => void;
  verticalOnly?: boolean;
  className?: string;
}

function formatDisplayTime(time: string): string {
  const minutes = timeToMinutes(time);
  if (minutes < 24 * 60) return time;
  return minutesToTime(minutes % (24 * 60));
}

function getDurationMinutes(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  return endMinutes - startMinutes;
}

export function CalendarEntryBlock({
  entry,
  style,
  compact = false,
  readOnly = false,
  onDoubleClick,
  onResizeEnd,
  onRepositionEnd,
  verticalOnly = false,
  className = '',
}: CalendarEntryBlockProps) {
  const blockRef     = useRef<HTMLDivElement>(null);
  const canReposition = !!onRepositionEnd;
  const canResize    = !!onResizeEnd;
  const canOpen      = !!onDoubleClick;
  const slotHeight   = useSlotHeight();
  const isMobileGrid = slotHeight < SLOT_HEIGHT;

  // ── Drag to reposition ──────────────────────────────────────────────────
  const handleDragPointerDown = (e: React.PointerEvent) => {
    if (!canReposition) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();

    // Save captureTarget in closure so onUp can release it correctly
    const captureTarget = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);

    const startY     = e.clientY;
    const startX     = e.clientX;
    const initialTop = blockRef.current
      ? parseFloat(window.getComputedStyle(blockRef.current).top) || blockRef.current.offsetTop
      : 0;
    const duration   = getDurationMinutes(entry.startTime, entry.endTime);
    let currentTop   = initialTop; // track in closure — avoids DOM read on pointerup
    let hasMoved     = false;

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      if (Math.abs(dy) > 4 || Math.abs(dx) > 4) hasMoved = true;
      if (!hasMoved) return;
      currentTop = Math.max(0, initialTop + dy);
      if (blockRef.current) {
        if (verticalOnly) {
          blockRef.current.style.top = `${currentTop}px`;
        } else {
          blockRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        }
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
          blockRef.current.style.transform = '';
          blockRef.current.style.zIndex  = '';
          blockRef.current.style.opacity = '';
          blockRef.current.style.cursor  = '';
        }
        const rawMinutes = (currentTop / SLOT_HEIGHT) * 60;
        const snapped    = snapTo15Min(rawMinutes);
        const startMins  = Math.max(0, Math.min(snapped, END_HOUR * 60 - duration));
        const pos = verticalOnly ? undefined : { x: ev.clientX, y: ev.clientY };
        onRepositionEnd(entry.id, minutesToTime(startMins), minutesToTime(startMins + duration), pos);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Resize handle ───────────────────────────────────────────────────────
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!canResize) return;
    e.preventDefault();
    e.stopPropagation();

    const captureTarget = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);

    const startY         = e.clientY;
    let initialEndMins = timeToMinutes(entry.endTime);
    const startMins    = timeToMinutes(entry.startTime);
    if (initialEndMins <= startMins) {
      initialEndMins += 24 * 60;
    }
    const initialHeight  = blockRef.current?.getBoundingClientRect().height ?? 0;
    let liveHeight       = initialHeight;

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      liveHeight = Math.max(initialHeight + dy, slotHeight / 4);
      if (blockRef.current) blockRef.current.style.height = `${liveHeight}px`;
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      captureTarget.releasePointerCapture(ev.pointerId);

      if (blockRef.current) blockRef.current.style.height = '';

      const deltaMins = ((liveHeight - initialHeight) / slotHeight) * 60;
      const raw       = initialEndMins + deltaMins;
      const snapped   = snapTo15Min(raw);
      const finalMins = Math.max(startMins + 15, Math.min(snapped, END_HOUR * 60));
      onResizeEnd?.(entry.id, minutesToTime(finalMins));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={blockRef}
      onPointerDown={handleDragPointerDown}
      onDoubleClick={(e) => {
        if (!canOpen) return;
        e.stopPropagation();
        onDoubleClick?.(entry.id, e.currentTarget);
      }}
      style={{ ...style, boxShadow: 'none' }}
      className={[
        `absolute left-1 right-1 rounded-lg ${compact ? 'px-1.5 py-1' : 'px-2.5 py-1.5'} select-none overflow-hidden transition-colors`,
        readOnly
          ? `bg-[var(--color-google-event)] ${canReposition ? 'cursor-grab' : canOpen ? 'cursor-pointer' : 'cursor-default'}`
          : [
              'bg-[var(--color-accent-subtle)]',
              'hover:bg-[color-mix(in_srgb,var(--color-accent-subtle)_88%,white_12%)]',
              canReposition ? 'cursor-grab' : 'cursor-pointer',
            ].join(' '),
        className,
      ].join(' ')}
    >
      <p className={[
        `${compact ? 'text-[10px]' : 'text-xs'} font-semibold leading-tight truncate`,
        readOnly ? 'text-[var(--color-google-event-text)]' : 'text-[var(--color-accent)]',
      ].join(' ')}>
        {entry.title}
      </p>
      <p className={[
        `${compact ? 'text-[9px]' : 'text-[10px]'} mt-0.5`,
        readOnly ? 'text-[color-mix(in_srgb,var(--color-google-event-text)_72%,var(--color-text-secondary))]' : 'text-[var(--color-text-secondary)]',
      ].join(' ')}>
        {formatDisplayTime(entry.startTime)} – {formatDisplayTime(entry.endTime)}
      </p>

      {canResize && (
        <div
          onPointerDown={handleResizePointerDown}
          className={`absolute bottom-0 left-0 right-0 ${isMobileGrid ? 'h-6' : 'h-2'} cursor-row-resize flex items-center justify-center group`}
        >
          <div className={`w-6 h-0.5 rounded-full ${readOnly ? 'bg-[var(--color-google-event-text)]' : 'bg-[var(--color-accent)]'} opacity-30 group-hover:opacity-70 transition-opacity`} />
        </div>
      )}
    </div>
  );
}
