'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import { DateTimePicker } from './DateTimePicker';

interface CalendarEntryDetailPopoverProps {
  entryId: string;
  anchor: HTMLElement;
  onClose: () => void;
}

export function CalendarEntryDetailPopover({ entryId, anchor, onClose }: CalendarEntryDetailPopoverProps) {
  const { calendarEntries, updateCalendarEntry, deleteCalendarEntry } = usePlannerStore();
  const entry = calendarEntries.find((e) => e.id === entryId);

  const [title,     setTitle]     = useState(entry?.title     ?? '');
  const [startTime, setStartTime] = useState(entry?.startTime ?? '');
  const [endTime,   setEndTime]   = useState(entry?.endTime   ?? '');
  const [notes,     setNotes]     = useState(entry?.notes     ?? '');

  if (!entry) return null;

  const handleClose = useCallback(() => {
    updateCalendarEntry(entryId, {
      title:     title.trim() || entry.title,
      startTime: startTime    || entry.startTime,
      endTime:   endTime      || entry.endTime,
      notes,
    });
    onClose();
  }, [endTime, entry, entryId, notes, onClose, startTime, title, updateCalendarEntry]);

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

  return (
    <DetailPopover
      anchor={anchor}
      onClose={handleClose}
      className="w-[24rem]"
      headerActions={(
        <button
          onClick={() => { deleteCalendarEntry(entryId); onClose(); }}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          aria-label="Delete event"
        >
          <Trash2 size={12} strokeWidth={2.25} />
        </button>
      )}
    >
      <div className="flex flex-col gap-5">
        <PopoverField label="Title">
          <PopoverInput value={title} onChange={setTitle} placeholder="Event title" />
        </PopoverField>

        <PopoverField label="Time">
          <DateTimePicker
            date={entry.date}
            startTime={startTime}
            endTime={endTime}
            showTime
            onDateChange={() => {/* date is bound to grid day, not editable here */}}
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
