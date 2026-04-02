'use client';

import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { Check, Sparkles, Trash2 } from 'lucide-react';
import { usePlannerStore, selectMergedGoogleCalendarEntryById } from '@/store/usePlannerStore';
import type { CalendarEntry } from '@/types';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import { DateTimePicker } from './DateTimePicker';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { minutesToTime, timeToMinutes } from '@/lib/timeGrid';

interface GoogleCalendarEntryDetailPopoverProps {
  entryId: string;
  anchor: HTMLElement;
  onClose: () => void;
  isDraft?: boolean;
}

export function GoogleCalendarEntryDetailPopover({
  entryId,
  anchor,
  onClose,
  isDraft = false,
}: GoogleCalendarEntryDetailPopoverProps) {
  const googleEntries = usePlannerStore((s) => s.googleCalendarEntries);
  const entry = selectMergedGoogleCalendarEntryById(googleEntries, entryId);
  if (!entry) return null;

  return (
    <GoogleCalendarEntryDetailPopoverInner
      key={`${entry.id}:${entry.updatedAt}:${isDraft ? 'draft' : 'saved'}`}
      entry={entry}
      anchor={anchor}
      onClose={onClose}
      isDraft={isDraft}
    />
  );
}

function GoogleCalendarEntryDetailPopoverInner({
  entry,
  anchor,
  onClose,
  isDraft,
}: {
  entry: CalendarEntry;
  anchor: HTMLElement;
  onClose: () => void;
  isDraft: boolean;
}) {
  const googleEntries = usePlannerStore((s) => s.googleCalendarEntries);
  const applyOptimisticGoogleEntry = usePlannerStore((s) => s.applyOptimisticGoogleEntry);
  const applyOptimisticGoogleDelete = usePlannerStore((s) => s.applyOptimisticGoogleDelete);
  const clearPendingGoogleMutation = usePlannerStore((s) => s.clearPendingGoogleMutation);
  const setGoogleCalendarEntries = usePlannerStore((s) => s.setGoogleCalendarEntries);
  const { refresh } = useGoogleCalendar();
  const baseStartDate = entry.startDate ?? entry.date;
  const baseEndDate = entry.endDate ?? baseStartDate;

  const [title, setTitle] = useState(entry.title);
  const [date, setDate] = useState<string | undefined>(baseStartDate);
  const [endDate, setEndDate] = useState<string | undefined>(baseEndDate);
  const [startTime, setStartTime] = useState(entry.startTime);
  const [endTime, setEndTime] = useState(entry.endTime);
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [emojiLoading, setEmojiLoading] = useState(false);
  const baseEventId = entry.id.split('::')[0];

  const handleStartTimeChange = useCallback((nextStartTime: string) => {
    setStartTime(nextStartTime);

    const startMinutes = timeToMinutes(nextStartTime);
    const nextEndMinutes = startMinutes + 60;
    const nextBaseDate = date ?? baseStartDate;

    setEndTime(minutesToTime(nextEndMinutes));
    setEndDate(
      nextEndMinutes >= 24 * 60
        ? format(addDays(new Date(`${nextBaseDate}T00:00:00`), 1), 'yyyy-MM-dd')
        : nextBaseDate
    );
  }, [baseStartDate, date]);

  const handleClose = useCallback(() => {
    const nextTitle = title.trim() || entry.title;
    const nextDate = date ?? baseStartDate;
    let nextEndDate = endDate ?? nextDate;
    const nextStart = startTime || entry.startTime;
    const nextEnd = endTime || entry.endTime;
    const nextNotes = notes;

    const hasChanges =
      nextTitle !== entry.title ||
      nextDate !== baseStartDate ||
      nextEndDate !== baseEndDate ||
      nextStart !== entry.startTime ||
      nextEnd !== entry.endTime ||
      nextNotes !== (entry.notes ?? '');

    if (!hasChanges) {
      onClose();
      return;
    }

    const startMinutes = timeToMinutes(nextStart);
    const endMinutes = timeToMinutes(nextEnd);
    if (nextEndDate < nextDate) {
      nextEndDate = nextDate;
    }
    if (nextEndDate === nextDate && endMinutes <= startMinutes) {
      nextEndDate = format(addDays(new Date(`${nextDate}T00:00:00`), 1), 'yyyy-MM-dd');
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const optimisticEntry: CalendarEntry = {
      ...entry,
      id: baseEventId,
      title: nextTitle,
      startDate: nextDate,
      endDate: nextEndDate,
      date: nextDate,
      startTime: nextStart,
      endTime: nextEnd,
      notes: nextNotes || undefined,
    };

    applyOptimisticGoogleEntry(optimisticEntry);

    api.patchGoogleTimedEvent(baseEventId, {
      title: nextTitle,
      date: nextDate,
      endDate: nextEndDate,
      startTime: nextStart,
      endTime: nextEnd,
      notes: nextNotes || undefined,
      tz,
    }).then(() => {
      refresh();
    }).catch((err) => {
      console.error('[patchGoogleTimedEvent]', err);
      setGoogleCalendarEntries(googleEntries);
      clearPendingGoogleMutation(baseEventId);
    }).finally(() => {
      onClose();
    });
  }, [applyOptimisticGoogleEntry, baseEndDate, baseEventId, baseStartDate, clearPendingGoogleMutation, date, endDate, endTime, entry, googleEntries, notes, onClose, refresh, setGoogleCalendarEntries, startTime, title]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

      const target = event.target;
      if (target instanceof HTMLTextAreaElement) return;

      event.preventDefault();
      handleClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleDelete = () => {
    applyOptimisticGoogleDelete(baseEventId);
    api.deleteGoogleTimedEvent(baseEventId).then(() => {
      refresh();
    }).catch((err) => {
      console.error('[deleteGoogleTimedEvent]', err);
      setGoogleCalendarEntries(googleEntries);
      clearPendingGoogleMutation(baseEventId);
    }).finally(() => {
      onClose();
    });
  };

  const nextTitle = title.trim() || entry.title;
  const nextDate = date ?? baseStartDate;
  const nextEndDate = endDate ?? nextDate;
  const nextStart = startTime || entry.startTime;
  const nextEnd = endTime || entry.endTime;
  const hasChanges =
    nextTitle !== entry.title ||
    nextDate !== baseStartDate ||
    nextEndDate !== baseEndDate ||
    nextStart !== entry.startTime ||
    nextEnd !== entry.endTime ||
    notes !== (entry.notes ?? '');
  const showSaveAction = isDraft || hasChanges;
  const handleSuggestEmoji = async () => {
    const baseTitle = title.trim();
    if (!baseTitle || emojiLoading) return;

    setEmojiLoading(true);
    try {
      const emoji = await api.suggestEmoji(baseTitle);
      setTitle((current) => current.startsWith(`${emoji} `) ? current : `${emoji} ${current.trim()}`);
    } catch (err) {
      console.error('[suggestEmoji]', err);
    } finally {
      setEmojiLoading(false);
    }
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={handleClose}
      className="w-[24rem]"
      headerActions={(
        <>
          {showSaveAction && (
            <button
              onClick={handleClose}
              className="ui-icon-button ui-icon-button--accent"
              aria-label={isDraft ? 'Create event' : 'Save event'}
              title={isDraft ? 'Create event' : 'Save event'}
            >
              <Check size={12} strokeWidth={2.5} />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="ui-icon-button ui-icon-button--danger"
            aria-label="Delete Google event"
          >
            <Trash2 size={12} strokeWidth={2.25} />
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <PopoverField label="Title">
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSuggestEmoji}
                disabled={!title.trim() || emojiLoading}
                className="ui-icon-button text-[var(--color-text-muted)] disabled:opacity-40"
                aria-label="Suggest emoji"
                title="Suggest emoji"
              >
                <Sparkles size={12} strokeWidth={2.2} />
              </button>
            </div>
            <PopoverInput value={title} onChange={setTitle} placeholder="Event title" />
          </div>
        </PopoverField>

        <PopoverField label="Time">
          <DateTimePicker
            date={date}
            endDate={endDate}
            startTime={startTime}
            endTime={endTime}
            showTime
            showEndDate
            onDateChange={setDate}
            onEndDateChange={setEndDate}
            onStartTimeChange={handleStartTimeChange}
            onEndTimeChange={setEndTime}
          />
        </PopoverField>

        <PopoverField label="Notes">
          <PopoverInput value={notes} onChange={setNotes} placeholder="Add notes…" multiline />
        </PopoverField>
      </div>
    </DetailPopover>
  );
}
