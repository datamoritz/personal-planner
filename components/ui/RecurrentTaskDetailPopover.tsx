'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import type { RecurrenceFrequency } from '@/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function FrequencyEditor({
  value,
  onChange,
}: {
  value: RecurrenceFrequency;
  onChange: (f: RecurrenceFrequency) => void;
}) {
  const select =
    'w-full bg-[var(--color-surface)] border border-[var(--color-popover-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors cursor-pointer';

  return (
    <div className="flex flex-col gap-2">
      <select
        value={value.type}
        onChange={(e) => {
          const t = e.target.value as RecurrenceFrequency['type'];
          if (t === 'daily') onChange({ type: 'daily' });
          else if (t === 'weekly') onChange({ type: 'weekly', dayOfWeek: 1 });
          else if (t === 'monthly') onChange({ type: 'monthly', dayOfMonth: 1 });
          else onChange({ type: 'custom', intervalDays: 7 });
        }}
        className={select}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="custom">Every N days</option>
      </select>

      {value.type === 'weekly' && (
        <select
          value={value.dayOfWeek}
          onChange={(e) => onChange({ type: 'weekly', dayOfWeek: Number(e.target.value) })}
          className={select}
        >
          {DAYS.map((d, i) => (
            <option key={i} value={i}>{d}</option>
          ))}
        </select>
      )}

      {value.type === 'monthly' && (
        <input
          type="number"
          min={1}
          max={31}
          value={value.dayOfMonth}
          onChange={(e) => onChange({ type: 'monthly', dayOfMonth: Number(e.target.value) })}
          placeholder="Day of month (1–31)"
          className="w-full bg-[var(--color-surface)] border border-[var(--color-popover-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
      )}

      {value.type === 'custom' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Every</span>
          <input
            type="number"
            min={1}
            value={value.intervalDays}
            onChange={(e) => onChange({ type: 'custom', intervalDays: Number(e.target.value) })}
            className="w-16 bg-[var(--color-surface)] border border-[var(--color-popover-border)] rounded-lg px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors text-center"
          />
          <span className="text-xs text-[var(--color-text-muted)]">days</span>
        </div>
      )}
    </div>
  );
}

interface RecurrentTaskDetailPopoverProps {
  recurrentTaskId: string;
  anchor: HTMLElement;
  onClose: () => void;
}

export function RecurrentTaskDetailPopover({
  recurrentTaskId,
  anchor,
  onClose,
}: RecurrentTaskDetailPopoverProps) {
  const { recurrentTasks, updateRecurrentTask, deleteRecurrentTask } = usePlannerStore();
  const rt = recurrentTasks.find((r) => r.id === recurrentTaskId);

  const [title, setTitle] = useState(rt?.title ?? '');
  const [notes, setNotes] = useState(rt?.notes ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    rt?.frequency ?? { type: 'daily' }
  );

  if (!rt) return null;

  const handleClose = () => {
    updateRecurrentTask(recurrentTaskId, {
      title: title.trim() || rt.title,
      notes,
      frequency,
    });
    onClose();
  };

  return (
    <DetailPopover anchor={anchor} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <PopoverField label="Title">
          <PopoverInput value={title} onChange={setTitle} placeholder="Task title" />
        </PopoverField>

        <PopoverField label="Recurs">
          <FrequencyEditor value={frequency} onChange={setFrequency} />
        </PopoverField>

        <PopoverField label="Notes">
          <PopoverInput value={notes} onChange={setNotes} placeholder="Add notes…" multiline />
        </PopoverField>

        <div className="flex justify-end pt-1 border-t border-[var(--color-popover-border)]">
          <button
            onClick={() => { deleteRecurrentTask(recurrentTaskId); onClose(); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
    </DetailPopover>
  );
}
