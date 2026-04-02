'use client';

import { useCallback, useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { Check, Sparkles, Trash2 } from 'lucide-react';
import { usePlannerStore, selectMergedGoogleCalendarEntryById } from '@/store/usePlannerStore';
import type { AllDayEvent, CalendarEntry } from '@/types';
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
  const googleAllDayEvents = usePlannerStore((s) => s.googleAllDayEvents);
  const timedEntry = selectMergedGoogleCalendarEntryById(googleEntries, entryId);
  const allDayEntry = googleAllDayEvents.find((event) => event.id === entryId);
  const entry = timedEntry ?? allDayEntry;
  if (!entry) return null;

  return (
    <GoogleCalendarEntryDetailPopoverInner
      key={`${entry.id}:${entry.updatedAt}:${timedEntry ? 'timed' : 'all-day'}:${isDraft ? 'draft' : 'saved'}`}
      entry={entry}
      anchor={anchor}
      onClose={onClose}
      isDraft={isDraft}
      initialIsAllDay={!timedEntry}
    />
  );
}

function GoogleCalendarEntryDetailPopoverInner({
  entry,
  anchor,
  onClose,
  isDraft,
  initialIsAllDay,
}: {
  entry: CalendarEntry | AllDayEvent;
  anchor: HTMLElement;
  onClose: () => void;
  isDraft: boolean;
  initialIsAllDay: boolean;
}) {
  const googleEntries = usePlannerStore((s) => s.googleCalendarEntries);
  const googleAllDayEvents = usePlannerStore((s) => s.googleAllDayEvents);
  const applyOptimisticGoogleEntry = usePlannerStore((s) => s.applyOptimisticGoogleEntry);
  const applyOptimisticGoogleDelete = usePlannerStore((s) => s.applyOptimisticGoogleDelete);
  const applyOptimisticGoogleAllDayEvent = usePlannerStore((s) => s.applyOptimisticGoogleAllDayEvent);
  const applyOptimisticGoogleAllDayDelete = usePlannerStore((s) => s.applyOptimisticGoogleAllDayDelete);
  const clearPendingGoogleMutation = usePlannerStore((s) => s.clearPendingGoogleMutation);
  const clearPendingGoogleAllDayMutation = usePlannerStore((s) => s.clearPendingGoogleAllDayMutation);
  const setGoogleCalendarEntries = usePlannerStore((s) => s.setGoogleCalendarEntries);
  const setGoogleAllDayEvents = usePlannerStore((s) => s.setGoogleAllDayEvents);
  const { refresh } = useGoogleCalendar();
  const isTimedEntry = 'startTime' in entry;
  const baseStartDate = (isTimedEntry ? entry.startDate : undefined) ?? entry.date;
  const baseEndDate = (entry.endDate ?? baseStartDate);

  const [title, setTitle] = useState(entry.title);
  const [date, setDate] = useState<string | undefined>(baseStartDate);
  const [endDate, setEndDate] = useState<string | undefined>(baseEndDate);
  const [startTime, setStartTime] = useState(isTimedEntry ? entry.startTime : '09:00');
  const [endTime, setEndTime] = useState(isTimedEntry ? entry.endTime : '10:00');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [isAllDay, setIsAllDay] = useState(initialIsAllDay);
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
    const nextStart = startTime || (isTimedEntry ? entry.startTime : '09:00');
    const nextEnd = endTime || (isTimedEntry ? entry.endTime : '10:00');
    const nextNotes = notes;

    const hasChanges =
      isAllDay !== initialIsAllDay ||
      nextTitle !== entry.title ||
      nextDate !== baseStartDate ||
      nextEndDate !== baseEndDate ||
      nextStart !== (isTimedEntry ? entry.startTime : '09:00') ||
      nextEnd !== (isTimedEntry ? entry.endTime : '10:00') ||
      nextNotes !== (entry.notes ?? '');

    if (!hasChanges) {
      onClose();
      return;
    }

    if (nextEndDate < nextDate) {
      nextEndDate = nextDate;
    }
    if (isAllDay) {
      const optimisticAllDayEvent: AllDayEvent = {
        id: baseEventId,
        title: nextTitle,
        date: nextDate,
        endDate: nextEndDate,
        source: 'google',
        notes: nextNotes || undefined,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };

      if (!initialIsAllDay) {
        applyOptimisticGoogleDelete(baseEventId);
      }
      applyOptimisticGoogleAllDayEvent(optimisticAllDayEvent);

      api.patchGoogleAllDayEvent(baseEventId, {
        title: nextTitle,
        date: nextDate,
        endDate: nextEndDate,
        notes: nextNotes || undefined,
      }).then(() => {
        refresh();
      }).catch((err) => {
        console.error('[patchGoogleAllDayEvent]', err);
        setGoogleCalendarEntries(googleEntries);
        setGoogleAllDayEvents(googleAllDayEvents);
        clearPendingGoogleMutation(baseEventId);
        clearPendingGoogleAllDayMutation(baseEventId);
      }).finally(() => {
        onClose();
      });
      return;
    }

    const startMinutes = timeToMinutes(nextStart);
    const endMinutes = timeToMinutes(nextEnd);
    if (nextEndDate === nextDate && endMinutes <= startMinutes) {
      nextEndDate = format(addDays(new Date(`${nextDate}T00:00:00`), 1), 'yyyy-MM-dd');
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const optimisticEntry: CalendarEntry = {
      ...(isTimedEntry ? entry : {
        id: baseEventId,
        title: nextTitle,
        date: nextDate,
        startTime: nextStart,
        endTime: nextEnd,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }),
      id: baseEventId,
      title: nextTitle,
      startDate: nextDate,
      endDate: nextEndDate,
      date: nextDate,
      startTime: nextStart,
      endTime: nextEnd,
      notes: nextNotes || undefined,
    };

    if (initialIsAllDay) {
      applyOptimisticGoogleAllDayDelete(baseEventId);
    }
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
      setGoogleAllDayEvents(googleAllDayEvents);
      clearPendingGoogleMutation(baseEventId);
      clearPendingGoogleAllDayMutation(baseEventId);
    }).finally(() => {
      onClose();
    });
  }, [applyOptimisticGoogleAllDayDelete, applyOptimisticGoogleAllDayEvent, applyOptimisticGoogleDelete, applyOptimisticGoogleEntry, baseEndDate, baseEventId, baseStartDate, clearPendingGoogleAllDayMutation, clearPendingGoogleMutation, date, endDate, endTime, entry, googleAllDayEvents, googleEntries, initialIsAllDay, isAllDay, isTimedEntry, notes, onClose, refresh, setGoogleAllDayEvents, setGoogleCalendarEntries, startTime, title]);

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
    if (isAllDay) {
      applyOptimisticGoogleAllDayDelete(baseEventId);
      api.deleteGoogleAllDayEvent(baseEventId).then(() => {
        refresh();
      }).catch((err) => {
        console.error('[deleteGoogleAllDayEvent]', err);
        setGoogleAllDayEvents(googleAllDayEvents);
        clearPendingGoogleAllDayMutation(baseEventId);
      }).finally(() => {
        onClose();
      });
      return;
    }

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
  const nextStart = startTime || (isTimedEntry ? entry.startTime : '09:00');
  const nextEnd = endTime || (isTimedEntry ? entry.endTime : '10:00');
  const hasChanges =
    isAllDay !== initialIsAllDay ||
    nextTitle !== entry.title ||
    nextDate !== baseStartDate ||
    nextEndDate !== baseEndDate ||
    nextStart !== (isTimedEntry ? entry.startTime : '09:00') ||
    nextEnd !== (isTimedEntry ? entry.endTime : '10:00') ||
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
          <PopoverInput value={title} onChange={setTitle} placeholder="Event title" />
        </PopoverField>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="ui-section-label">Time</span>
            <button
              type="button"
              onClick={() => setIsAllDay((current) => !current)}
              className="inline-flex items-center gap-1.5 px-0.5 py-0.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              <span
                className={[
                  'flex h-3.5 w-3.5 items-center justify-center rounded-full border transition-colors',
                  isAllDay
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                    : 'border-[var(--color-border-strong)] bg-transparent',
                ].join(' ')}
                aria-hidden="true"
              >
                {isAllDay && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span>All day</span>
            </button>
          </div>

          <DateTimePicker
            date={date}
            endDate={endDate}
            startTime={startTime}
            endTime={endTime}
            showTime={!isAllDay}
            showEndDate
            onDateChange={setDate}
            onEndDateChange={setEndDate}
            onStartTimeChange={handleStartTimeChange}
            onEndTimeChange={setEndTime}
          />
        </div>

        <PopoverField label="Notes">
          <PopoverInput
            value={notes}
            onChange={setNotes}
            placeholder="Add notes…"
            multiline
            minHeight={isAllDay ? 124 : 72}
          />
        </PopoverField>
      </div>
    </DetailPopover>
  );
}
