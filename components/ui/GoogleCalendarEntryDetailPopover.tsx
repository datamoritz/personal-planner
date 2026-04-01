'use client';

import { useEffect, useState } from 'react';
import { addDays, format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import { DateTimePicker } from './DateTimePicker';
import * as api from '@/lib/api';
import { useGoogleCalendar } from '@/lib/useGoogleCalendar';
import { timeToMinutes } from '@/lib/timeGrid';

interface GoogleCalendarEntryDetailPopoverProps {
  entryId: string;
  anchor: HTMLElement;
  onClose: () => void;
}

export function GoogleCalendarEntryDetailPopover({
  entryId,
  anchor,
  onClose,
}: GoogleCalendarEntryDetailPopoverProps) {
  const googleEntries = usePlannerStore((s) => s.googleCalendarEntries);
  const setGoogleCalendarEntries = usePlannerStore((s) => s.setGoogleCalendarEntries);
  const entry = googleEntries.find((e) => e.id === entryId);
  const { refresh } = useGoogleCalendar();

  const [title, setTitle] = useState(entry?.title ?? '');
  const [date, setDate] = useState(entry?.date);
  const [startTime, setStartTime] = useState(entry?.startTime ?? '');
  const [endTime, setEndTime] = useState(entry?.endTime ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');

  useEffect(() => {
    if (!entry) return;
    setTitle(entry.title);
    setDate(entry.date);
    setStartTime(entry.startTime);
    setEndTime(entry.endTime);
    setNotes(entry.notes ?? '');
  }, [entry]);

  if (!entry) return null;
  const baseEventId = entry.id.split('::')[0];

  const handleClose = () => {
    const nextTitle = title.trim() || entry.title;
    const nextDate = date ?? entry.date;
    const nextStart = startTime || entry.startTime;
    const nextEnd = endTime || entry.endTime;
    const nextNotes = notes;

    const hasChanges =
      nextTitle !== entry.title ||
      nextDate !== entry.date ||
      nextStart !== entry.startTime ||
      nextEnd !== entry.endTime ||
      nextNotes !== (entry.notes ?? '');

    if (!hasChanges) {
      onClose();
      return;
    }

    const startMinutes = timeToMinutes(nextStart);
    const endMinutes = timeToMinutes(nextEnd);
    const baseDate = new Date(`${nextDate}T00:00:00`);
    const endDate = endMinutes < startMinutes ? format(addDays(baseDate, 1), 'yyyy-MM-dd') : nextDate;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    api.patchGoogleTimedEvent(baseEventId, {
      title: nextTitle,
      date: nextDate,
      endDate,
      startTime: nextStart,
      endTime: nextEnd,
      notes: nextNotes || undefined,
      tz,
    }).then(() => {
      refresh();
    }).catch((err) => {
      console.error('[patchGoogleTimedEvent]', err);
    }).finally(() => {
      onClose();
    });
  };

  const handleDelete = () => {
    api.deleteGoogleTimedEvent(baseEventId).then(() => {
      setGoogleCalendarEntries(
        googleEntries.filter((e) => e.id.split('::')[0] !== baseEventId)
      );
      refresh();
    }).catch((err) => {
      console.error('[deleteGoogleTimedEvent]', err);
    }).finally(() => {
      onClose();
    });
  };

  return (
    <DetailPopover
      anchor={anchor}
      onClose={handleClose}
      headerActions={(
        <button
          onClick={handleDelete}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer"
          aria-label="Delete Google event"
        >
          <Trash2 size={12} strokeWidth={2.25} />
        </button>
      )}
    >
      <div className="flex flex-col gap-4">
        <PopoverField label="Title">
          <PopoverInput value={title} onChange={setTitle} placeholder="Event title" />
        </PopoverField>

        <PopoverField label="Time">
          <DateTimePicker
            date={date}
            startTime={startTime}
            endTime={endTime}
            showTime
            onDateChange={setDate}
            onStartTimeChange={setStartTime}
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
