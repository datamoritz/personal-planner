'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import * as api from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { TextDraftMode, TextDraftResponse } from '@/types';
import { TaskDetailPopover } from './TaskDetailPopover';
import { GoogleCalendarEntryDetailPopover } from './GoogleCalendarEntryDetailPopover';

type PopoverState =
  | { type: 'task'; id: string; anchor: HTMLElement; isDraft: boolean }
  | { type: 'event'; id: string; anchor: HTMLElement; isDraft: boolean }
  | null;

function createTemporaryAnchor(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const anchor = document.createElement('div');
  anchor.style.position = 'fixed';
  anchor.style.left = `${rect.left + rect.width / 2}px`;
  anchor.style.top = `${rect.bottom - 8}px`;
  anchor.style.width = '1px';
  anchor.style.height = '1px';
  anchor.style.pointerEvents = 'none';
  anchor.style.opacity = '0';
  anchor.dataset.popoverAnchor = 'temporary';
  document.body.appendChild(anchor);
  return anchor;
}

function fallbackTitle(text: string, mode: TextDraftMode): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return mode === 'event' ? 'New event' : 'New task';
  const clipped = normalized.split(' ').slice(0, 8).join(' ');
  return `${clipped}${normalized.split(' ').length > 8 ? '…' : ''}`;
}

function normalizeDraftLocation(draft: TextDraftResponse): 'today' | 'myday' {
  if (draft.location === 'myday' && draft.startTime) return 'myday';
  return 'today';
}

export function SmartCaptureBar({ autoFocusToken = 0 }: { autoFocusToken?: number }) {
  const currentDate = usePlannerStore((s) => s.currentDate);
  const viewMode = usePlannerStore((s) => s.viewMode);
  const addTask = usePlannerStore((s) => s.addTask);
  const updateTask = usePlannerStore((s) => s.updateTask);
  const applyOptimisticGoogleEntry = usePlannerStore((s) => s.applyOptimisticGoogleEntry);
  const applyOptimisticGoogleAllDayEvent = usePlannerStore((s) => s.applyOptimisticGoogleAllDayEvent);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<TextDraftMode>('task');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [popover, setPopover] = useState<PopoverState>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const isExpanded = isFocused || text.trim().length > 0;

  const closePopover = useCallback(() => {
    setPopover((current) => {
      if (current?.anchor.dataset.popoverAnchor === 'temporary') {
        current.anchor.remove();
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (popover?.anchor.dataset.popoverAnchor === 'temporary') {
        popover.anchor.remove();
      }
    };
  }, [popover]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
  }, [autoFocusToken]);

  const handleConvert = async (trigger: HTMLElement) => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const draft = await api.suggestTextDraft({
        text: trimmed,
        mode,
        currentDate,
        currentDateTime: new Date().toISOString(),
        currentView: api.normalizeExecutionView(viewMode),
        timezone,
      });

      const anchor = createTemporaryAnchor(trigger);

      if (mode === 'task') {
        const location = normalizeDraftLocation(draft);
        const taskDate = draft.taskDate ?? currentDate;
        const taskId = addTask({
          title: (draft.title ?? '').trim() || fallbackTitle(trimmed, 'task'),
          location,
          date: taskDate,
        });

        updateTask(taskId, {
          title: (draft.title ?? '').trim() || fallbackTitle(trimmed, 'task'),
          notes: draft.notes?.trim() || '',
          date: taskDate,
          startTime: draft.startTime ?? undefined,
          endTime: draft.endTime ?? undefined,
        });

        setPopover({ type: 'task', id: taskId, anchor, isDraft: true });
      } else if (draft.allDay) {
        const created = await api.createGoogleAllDayEvent({
          title: (draft.title ?? '').trim() || fallbackTitle(trimmed, 'event'),
          date: draft.taskDate ?? currentDate,
          notes: draft.notes?.trim() || undefined,
        });
        applyOptimisticGoogleAllDayEvent(created);
        setPopover({ type: 'event', id: created.id, anchor, isDraft: true });
      } else {
        const created = await api.createGoogleTimedEvent({
          title: (draft.title ?? '').trim() || fallbackTitle(trimmed, 'event'),
          date: draft.taskDate ?? currentDate,
          startTime: draft.startTime?.slice(0, 5) || '14:00',
          endTime: draft.endTime?.slice(0, 5) || '15:00',
          notes: draft.notes?.trim() || undefined,
          tz: timezone,
        });
        applyOptimisticGoogleEntry(created);
        setPopover({ type: 'event', id: created.id, anchor, isDraft: true });
      }

      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        className={[
          'relative flex min-w-0 items-center transition-[width] duration-300 ease-out',
        ].join(' ')}
        style={{ width: isExpanded ? 'min(38vw, 520px)' : 'min(27vw, 430px)' }}
      >
        <div
          className={[
            'flex w-full min-w-0 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]',
            'transition-[box-shadow,transform] duration-300 ease-out',
            isExpanded ? 'shadow-[0_10px_30px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.15)]' : '',
          ].join(' ')}
        >
          <div className="inline-flex rounded-full bg-transparent p-0.5">
              {(['task', 'event'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={[
                    'rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-all select-none',
                    mode === value
                      ? 'bg-[var(--color-canvas)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  ].join(' ')}
                >
                  {value}
                </button>
              ))}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void handleConvert(event.currentTarget as HTMLElement);
              }
            }}
            placeholder={mode === 'event' ? 'Create an event…' : 'Create a task…'}
            className={[
              'h-7 min-w-0 flex-1 rounded-full border border-transparent bg-transparent py-1 text-left text-[11px] leading-5 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-transparent focus:outline-none focus:ring-0',
              'transition-[padding,max-width] duration-300 ease-out',
              isExpanded ? 'px-2.5' : 'px-1.5',
            ].join(' ')}
          />

          <button
            type="button"
            onClick={(event) => void handleConvert(event.currentTarget)}
            disabled={!text.trim() || isSubmitting}
            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-accent)] transition-all hover:border-[var(--color-accent)]/35 hover:bg-[var(--color-canvas)] disabled:cursor-not-allowed disabled:opacity-45"
            title="Convert"
            aria-label="Convert"
          >
            {isSubmitting
              ? <Loader2 size={12} className="animate-spin" />
              : <Sparkles size={12} strokeWidth={2.2} />}
          </button>
        </div>
        {error && (
          <p className="absolute left-1/2 top-full mt-1 -translate-x-1/2 text-[10px] font-medium text-rose-500">
            {error}
          </p>
        )}
      </div>

      {popover?.type === 'task' && (
        <TaskDetailPopover
          taskId={popover.id}
          anchor={popover.anchor}
          isDraft={popover.isDraft}
          onClose={closePopover}
        />
      )}
      {popover?.type === 'event' && (
        <GoogleCalendarEntryDetailPopover
          entryId={popover.id}
          anchor={popover.anchor}
          isDraft={popover.isDraft}
          onClose={closePopover}
        />
      )}
    </>
  );
}
