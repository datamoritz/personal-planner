'use client';

import { useState } from 'react';
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

  const handleClose = () => {
    updateCalendarEntry(entryId, {
      title:     title.trim() || entry.title,
      startTime: startTime    || entry.startTime,
      endTime:   endTime      || entry.endTime,
      notes,
    });
    onClose();
  };

  return (
    <DetailPopover anchor={anchor} onClose={handleClose}>
      <div className="flex flex-col gap-4">
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

        <div className="flex justify-end pt-1 border-t border-[var(--color-popover-border)]">
          <button
            onClick={() => { deleteCalendarEntry(entryId); onClose(); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}
