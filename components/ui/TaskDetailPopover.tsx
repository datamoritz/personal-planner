'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { X } from 'lucide-react';
import { DetailPopover } from './DetailPopover';
import { PopoverField, PopoverInput } from './PopoverField';
import { DateTimePicker } from './DateTimePicker';

interface TaskDetailPopoverProps {
  taskId: string;
  anchor: HTMLElement;
  onClose: () => void;
}

export function TaskDetailPopover({ taskId, anchor, onClose }: TaskDetailPopoverProps) {
  const { tasks, tags, updateTask, deleteTask, setTaskTag } = usePlannerStore();
  const task = tasks.find((t) => t.id === taskId);

  const [title,     setTitle]     = useState(task?.title     ?? '');
  const [notes,     setNotes]     = useState(task?.notes     ?? '');
  const [date,      setDate]      = useState(task?.date);
  const [startTime, setStartTime] = useState(task?.startTime ?? '');
  const [endTime,   setEndTime]   = useState(task?.endTime   ?? '');

  const handleClose = () => {
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
  };

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

  const showTime = task.location === 'myday' || !!task.startTime;

  return (
    <DetailPopover
      anchor={anchor}
      onClose={handleClose}
      headerActions={(
        <button
          onClick={() => { deleteTask(taskId); onClose(); }}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-overdue)] hover:bg-[var(--color-overdue-subtle)] transition-colors cursor-pointer"
          aria-label="Delete task"
        >
          <Trash2 size={12} strokeWidth={2.25} />
        </button>
      )}
    >
      <div className="flex flex-col gap-4">
        {/* Tag picker */}
        {tags.length > 0 && (
          <PopoverField label="Tag">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setTaskTag(taskId, task.tagId === tag.id ? undefined : tag.id)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all cursor-pointer hover:opacity-90"
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
