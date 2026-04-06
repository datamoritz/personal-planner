'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Cake, Check, Loader2 } from 'lucide-react';
import * as api from '@/lib/api';
import type { AllDayEvent } from '@/types';
import { DetailPopover } from './DetailPopover';
import { PopoverInput } from './PopoverField';

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
  const EMOJIS = ['🎂', '🎈', '☀️', '🤗', '💛', '❤️', '🥳', '🎉'];
  const birthdayId = event.birthdayContactId;
  const [messageText, setMessageText] = useState('');
  const [initialMessageText, setInitialMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!birthdayId) {
      setMessageText('');
      setInitialMessageText('');
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

  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(() => setSaveNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

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
      setSaveNotice(next ? 'Saved to birthday message' : 'Birthday message cleared');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save birthday message');
    } finally {
      setIsSaving(false);
    }
  };

  const appendEmoji = (emoji: string) => {
    setMessageText((current) => `${current}${current ? ' ' : ''}${emoji}`);
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={onClose}
      className="w-[22rem]"
      title={undefined}
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
      <div className="flex flex-col gap-3.5 pt-2">
        <div className="flex items-start gap-3 pr-9">
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

        {!isLoading && (
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => appendEmoji(emoji)}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/92 px-2 text-[15px] shadow-[0_2px_8px_rgba(19,23,38,0.04)] hover:bg-[var(--color-surface-raised)]"
                title={`Add ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {saveNotice && (
          <div className="inline-flex self-start items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            <Check size={12} strokeWidth={2.4} />
            {saveNotice}
          </div>
        )}

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
