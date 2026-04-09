'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Clapperboard, Sparkles, Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { X } from 'lucide-react';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import { DateTimePicker } from './DateTimePicker';
import * as api from '@/lib/api';

interface TaskDetailPopoverProps {
  taskId: string;
  anchor: HTMLElement;
  onClose: () => void;
  isDraft?: boolean;
}

export function TaskDetailPopover({ taskId, anchor, onClose, isDraft = false }: TaskDetailPopoverProps) {
  const { tasks, tags, updateTask, deleteTask, setTaskTag, convertTaskToMedia } = usePlannerStore();
  const task = tasks.find((t) => t.id === taskId);

  const [title,     setTitle]     = useState(task?.title     ?? '');
  const [notes,     setNotes]     = useState(task?.notes     ?? '');
  const [date,      setDate]      = useState(task?.date);
  const [startTime, setStartTime] = useState(task?.startTime ?? '');
  const [endTime,   setEndTime]   = useState(task?.endTime   ?? '');
  const [emojiLoading, setEmojiLoading] = useState(false);

  const handleClose = useCallback(() => {
    if (!task) {
      onClose();
      return;
    }

    const updates: Parameters<typeof updateTask>[1] = {};
    if (title.trim() && title !== task.title)     updates.title     = title.trim();
    if (notes        !== task.notes)               updates.notes     = notes;
    if (date         !== task.date)                updates.date      = date;
    if (startTime    !== (task.startTime ?? ''))   updates.startTime = startTime || undefined;
    if (endTime      !== (task.endTime   ?? ''))   updates.endTime   = endTime   || undefined;
    if (Object.keys(updates).length) updateTask(taskId, updates);
    onClose();
  }, [date, endTime, notes, onClose, startTime, task, taskId, title, updateTask]);

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

  if (!task) return null;

  const normalizedTitle = task.title.trim().toLowerCase();
  const mediaKind =
    /^read(?:\s|:|-)/i.test(normalizedTitle) || normalizedTitle === 'read'
      ? 'read'
      : /^watch(?:\s|:|-)/i.test(normalizedTitle) || normalizedTitle === 'watch'
        ? 'watch'
        : null;
  const showTime = task.location === 'myday' || !!task.startTime;
  const hasChanges =
    title.trim() !== task.title ||
    notes !== (task.notes ?? '') ||
    date !== task.date ||
    startTime !== (task.startTime ?? '') ||
    endTime !== (task.endTime ?? '');
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
          {mediaKind && (
            <button
              type="button"
              onClick={() => {
                const converted = convertTaskToMedia(taskId, mediaKind);
                if (converted) onClose();
              }}
              className="ui-icon-button text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
              aria-label={mediaKind === 'read' ? 'Add to Read' : 'Add to Watch'}
              title={mediaKind === 'read' ? 'Add to Read' : 'Add to Watch'}
            >
              {mediaKind === 'read'
                ? <BookOpen size={12} strokeWidth={2.2} />
                : <Clapperboard size={12} strokeWidth={2.2} />}
            </button>
          )}
          <button
            onClick={() => { deleteTask(taskId); onClose(); }}
            className="ui-icon-button ui-icon-button--danger"
            aria-label="Delete task"
          >
            <Trash2 size={12} strokeWidth={2.25} />
          </button>
          {(isDraft || hasChanges) && (
            <button
              type="button"
              onClick={handleClose}
              className="ui-icon-button ui-icon-button--accent"
              aria-label={isDraft ? 'Create task' : 'Save task'}
              title={isDraft ? 'Create task' : 'Save task'}
            >
              <Check size={12} strokeWidth={2.5} />
            </button>
          )}
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        {/* Tag picker */}
        {tags.length > 0 && (
          <PopoverField label="Tag">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setTaskTag(taskId, task.tagId === tag.id ? undefined : tag.id)}
                  className="ui-chip border cursor-pointer hover:opacity-90"
                  style={{
                    background: tag.color,
                    borderColor: task.tagId === tag.id ? tag.colorDark : 'transparent',
                    color: tag.colorDark,
                    boxShadow: task.tagId === tag.id ? `0 0 0 1px ${tag.colorDark}` : 'none',
                  }}
                >
                  {tag.name}
                  {task.tagId === tag.id && <X size={9} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          </PopoverField>
        )}

        <PopoverField label="Title">
          <PopoverInput value={title} onChange={setTitle} placeholder="Task title" />
        </PopoverField>

        <PopoverField label="Schedule">
          <DateTimePicker
            date={date}
            startTime={startTime}
            endTime={endTime}
            showTime={showTime}
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
