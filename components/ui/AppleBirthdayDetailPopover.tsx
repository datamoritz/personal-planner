'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Cake, Check, Loader2 } from 'lucide-react';
import * as api from '@/lib/api';
import type { AllDayEvent } from '@/types';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';

interface AppleBirthdayDetailPopoverProps {
  event: AllDayEvent;
  anchor: HTMLElement;
  onClose: () => void;
}

export function AppleBirthdayDetailPopover({
  event,
  anchor,
  onClose,
}: AppleBirthdayDetailPopoverProps) {
  const birthdayId = event.birthdayContactId;
  const [messageText, setMessageText] = useState('');
  const [initialMessageText, setInitialMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!birthdayId) {
      setError('Birthday message is unavailable');
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.getAppleBirthdayMessage(birthdayId)
      .then((data) => {
        if (cancelled) return;
        const next = data.messageText ?? '';
        setMessageText(next);
        setInitialMessageText(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load birthday message');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [birthdayId]);

  const displayDate = useMemo(() => {
    try {
      return format(parseISO(event.date), 'EEEE, MMMM d');
    } catch {
      return event.date;
    }
  }, [event.date]);

  const hasChanges = messageText !== initialMessageText;

  const handleSave = async () => {
    if (!birthdayId || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await api.patchAppleBirthdayMessage(birthdayId, messageText);
      const next = saved.messageText ?? '';
      setMessageText(next);
      setInitialMessageText(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save birthday message');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={onClose}
      className="w-[22rem]"
      title="Birthday"
      headerActions={
        hasChanges ? (
          <button
            type="button"
            onClick={() => void handleSave()}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--color-accent-subtle)] text-[var(--color-accent)] hover:brightness-[0.98]"
            title="Save birthday message"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.5} />}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-2xl bg-[color-mix(in_srgb,#f97316_14%,white_86%)] text-[#b45309] flex items-center justify-center shadow-[0_10px_24px_rgba(249,115,22,0.12)]">
            <Cake size={16} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)] truncate">
              {event.title.replace(/^🎂\s*/, '')}
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {displayDate}
            </div>
          </div>
        </div>

        <PopoverField label="Birthday Message">
          {isLoading ? (
            <div className="rounded-[1rem] bg-[var(--color-surface-secondary)]/72 p-3">
              <div className="h-3 w-1/3 rounded bg-[var(--color-surface-raised)] animate-pulse" />
              <div className="mt-2 h-3 w-full rounded bg-[var(--color-surface-raised)] animate-pulse" />
              <div className="mt-2 h-3 w-4/5 rounded bg-[var(--color-surface-raised)] animate-pulse" />
            </div>
          ) : (
            <PopoverInput
              value={messageText}
              onChange={setMessageText}
              placeholder="Write a birthday message…"
              multiline
              minHeight={120}
            />
          )}
        </PopoverField>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl border border-[var(--color-border-subtle)] text-[12px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/72 hover:bg-[var(--color-surface-raised)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isLoading || !hasChanges}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/15 text-[12px] font-semibold hover:brightness-[0.985] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving && <Loader2 size={13} className="animate-spin" />}
            Save message
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}
