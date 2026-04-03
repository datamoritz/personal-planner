'use client';

import { useState } from 'react';
import { CalendarRange, Check, Sparkles, Trash2, X } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import type { RecurrenceFrequency } from '@/types';
import * as api from '@/lib/api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function FrequencyEditor({
  value,
  onChange,
}: {
  value: RecurrenceFrequency;
  onChange: (f: RecurrenceFrequency) => void;
}) {
  const select =
    'ui-input cursor-pointer';

  return (
    <div className="flex flex-col gap-2">
      <select
        value={value.type}
        onChange={(e) => {
          const t = e.target.value as RecurrenceFrequency['type'];
          if (t === 'daily') onChange({ type: 'daily' });
          else if (t === 'weekly') onChange({ type: 'weekly', dayOfWeek: 1 });
          else if (t === 'monthly') onChange({ type: 'monthly', dayOfMonth: 1 });
          else if (t === 'custom-days') onChange({ type: 'custom-days', intervalDays: 7 });
          else if (t === 'custom-weeks') onChange({ type: 'custom-weeks', intervalWeeks: 2, dayOfWeek: 1 });
          else onChange({ type: 'custom-months', intervalMonths: 2, dayOfMonth: 1 });
        }}
        className={select}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="custom-days">Every N days</option>
        <option value="custom-weeks">Every N weeks</option>
        <option value="custom-months">Every N months</option>
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
          className="ui-input"
        />
      )}

      {value.type === 'custom-days' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Every</span>
          <input
            type="number"
            min={1}
            value={value.intervalDays}
            onChange={(e) => onChange({ type: 'custom-days', intervalDays: Number(e.target.value) })}
            className="ui-input w-16 text-center"
          />
          <span className="text-xs text-[var(--color-text-muted)]">days</span>
        </div>
      )}

      {value.type === 'custom-weeks' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">Every</span>
            <input
              type="number"
              min={1}
              value={value.intervalWeeks}
              onChange={(e) => onChange({ ...value, intervalWeeks: Number(e.target.value) })}
              className="ui-input w-16 text-center"
            />
            <span className="text-xs text-[var(--color-text-muted)]">weeks on</span>
          </div>
          <select
            value={value.dayOfWeek}
            onChange={(e) => onChange({ ...value, dayOfWeek: Number(e.target.value) })}
            className={select}
          >
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {value.type === 'custom-months' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">Every</span>
            <input
              type="number"
              min={1}
              value={value.intervalMonths}
              onChange={(e) => onChange({ ...value, intervalMonths: Number(e.target.value) })}
              className="ui-input w-16 text-center"
            />
            <span className="text-xs text-[var(--color-text-muted)]">months</span>
          </div>
          <input
            type="number"
            min={1}
            max={31}
            value={value.dayOfMonth}
            onChange={(e) => onChange({ ...value, dayOfMonth: Number(e.target.value) })}
            placeholder="Day of month (1–31)"
            className="ui-input"
          />
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
  const {
    recurrentTasks,
    tags,
    updateRecurrentTask,
    deleteRecurrentTask,
    spawnRecurrentTasksForNextMonths,
    setRecurrentTaskTag,
  } = usePlannerStore();
  const rt = recurrentTasks.find((r) => r.id === recurrentTaskId);

  const [title, setTitle] = useState(rt?.title ?? '');
  const [notes, setNotes] = useState(rt?.notes ?? '');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    rt?.frequency ?? { type: 'daily' }
  );
  const [emojiLoading, setEmojiLoading] = useState(false);

  const hasChanges =
    (title.trim() || rt?.title || '') !== (rt?.title ?? '') ||
    notes !== (rt?.notes ?? '') ||
    JSON.stringify(frequency) !== JSON.stringify(rt?.frequency ?? { type: 'daily' });

  const handleClose = () => {
    if (!rt) {
      onClose();
      return;
    }

    updateRecurrentTask(recurrentTaskId, {
      title: title.trim() || rt.title,
      notes,
      frequency,
    });
    onClose();
  };

  if (!rt) return null;

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
          {hasChanges && (
            <button
              type="button"
              onClick={handleClose}
              className="ui-icon-button ui-icon-button--accent"
              aria-label="Save recurrent task"
              title="Save recurrent task"
            >
              <Check size={13} strokeWidth={2.25} />
            </button>
          )}
          <button
            type="button"
            onClick={() => spawnRecurrentTasksForNextMonths(recurrentTaskId)}
            className="ui-icon-button"
            title="Generate tasks for the rest of this year"
            aria-label="Generate tasks for the rest of this year"
          >
            <CalendarRange size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => { deleteRecurrentTask(recurrentTaskId); onClose(); }}
            className="ui-icon-button ui-icon-button--danger"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        {tags.length > 0 && (
          <PopoverField label="Tag">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setRecurrentTaskTag(recurrentTaskId, rt.tagId === tag.id ? undefined : tag.id)}
                  className="ui-chip border cursor-pointer hover:opacity-90"
                  style={{
                    background: tag.color,
                    borderColor: rt.tagId === tag.id ? tag.colorDark : 'transparent',
                    color: tag.colorDark,
                    boxShadow: rt.tagId === tag.id ? `0 0 0 1px ${tag.colorDark}` : 'none',
                  }}
                >
                  {tag.name}
                  {rt.tagId === tag.id && <X size={9} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          </PopoverField>
        )}

        <PopoverField label="Title">
          <PopoverInput value={title} onChange={setTitle} placeholder="Task title" />
        </PopoverField>

        <PopoverField label="Recurs">
          <FrequencyEditor value={frequency} onChange={setFrequency} />
        </PopoverField>

        <PopoverField label="Notes">
          <PopoverInput value={notes} onChange={setNotes} placeholder="Add notes…" multiline />
        </PopoverField>
      </div>
    </DetailPopover>
  );
}
