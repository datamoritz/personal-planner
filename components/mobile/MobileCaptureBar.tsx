'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import * as api from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { TextDraftMode, TextDraftResponse } from '@/types';
import { TaskDetailPopover } from '@/components/ui/TaskDetailPopover';
import { GoogleCalendarEntryDetailPopover } from '@/components/ui/GoogleCalendarEntryDetailPopover';

type PopoverState =
  | { type: 'task'; id: string; anchor: HTMLElement; isDraft: boolean }
  | { type: 'event'; id: string; anchor: HTMLElement; isDraft: boolean }
  | null;

function createTemporaryAnchor(): HTMLElement {
  const anchor = document.createElement('div');
  anchor.style.cssText = 'position:fixed;left:50%;top:50%;width:1px;height:1px;pointer-events:none;opacity:0;';
  anchor.dataset.popoverAnchor = 'temporary';
  document.body.appendChild(anchor);
  return anchor;
}

function fallbackTitle(text: string, mode: TextDraftMode): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return mode === 'event' ? 'New event' : 'New task';
  const words = normalized.split(' ');
  return words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
}

function normalizeDraftLocation(draft: TextDraftResponse): 'today' | 'myday' {
  if (draft.location === 'myday' && draft.startTime) return 'myday';
  return 'today';
}

export function MobileCaptureBar() {
  const currentDate  = usePlannerStore((s) => s.currentDate);
  const viewMode     = usePlannerStore((s) => s.viewMode);
  const addTask      = usePlannerStore((s) => s.addTask);
  const updateTask   = usePlannerStore((s) => s.updateTask);
  const applyOptimisticGoogleEntry      = usePlannerStore((s) => s.applyOptimisticGoogleEntry);
  const applyOptimisticGoogleAllDayEvent = usePlannerStore((s) => s.applyOptimisticGoogleAllDayEvent);

  const [text, setText]             = useState('');
  const [mode, setMode]             = useState<TextDraftMode>('task');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [popover, setPopover]       = useState<PopoverState>(null);
  const inputRef                    = useRef<HTMLInputElement>(null);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const closePopover = () => {
    setPopover((current) => {
      if (current?.anchor.dataset.popoverAnchor === 'temporary') current.anchor.remove();
      return null;
    });
  };

  const handleQuickAdd = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    const taskId = addTask({ title: trimmed, location: 'today', date: currentDate });
    setText('');
    const anchor = createTemporaryAnchor();
    setPopover({ type: 'task', id: taskId, anchor, isDraft: false });
  };

  const handleAISubmit = async () => {
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
      const anchor = createTemporaryAnchor();
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
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex-shrink-0 px-3 py-2 bg-[var(--color-canvas)] border-b border-[var(--color-border)]">
        {/* Mode toggle */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {(['task', 'event'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize transition-all',
                mode === m
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)]',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div className="flex items-center gap-1.5 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleAISubmit();
              }
            }}
            placeholder={mode === 'event' ? 'Describe an event…' : 'Capture a task…'}
            className="flex-1 bg-transparent text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none leading-none"
          />

          {/* Quick-add without AI */}
          <button
            type="button"
            onClick={handleQuickAdd}
            title="Quick add"
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors active:bg-[var(--color-surface-raised)]"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>

          {/* AI submit */}
          <button
            type="button"
            onClick={() => void handleAISubmit()}
            disabled={!text.trim() || isSubmitting}
            title="AI capture"
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-[var(--color-accent)] text-white disabled:opacity-40 transition-opacity active:opacity-70"
          >
            {isSubmitting
              ? <Loader2 size={13} className="animate-spin" />
              : <Sparkles size={13} strokeWidth={2.2} />}
          </button>
        </div>

        {error && (
          <p className="text-[10px] text-rose-500 mt-1 px-1">{error}</p>
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
