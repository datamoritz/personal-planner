'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePlannerStore } from '@/store/usePlannerStore';
import { MyDayColumn } from '@/components/columns/MyDayColumn';
import { TasksTodayColumn } from '@/components/columns/TasksTodayColumn';
import { InlineTaskInput } from '@/components/ui/InlineTaskInput';
import { SlotHeightProvider } from '@/lib/slotHeightContext';
import { MOBILE_SLOT_HEIGHT } from '@/lib/timeGrid';

type DayTab = 'schedule' | 'tasks';

const TABS: { label: string; value: DayTab }[] = [
  { label: 'Schedule', value: 'schedule' },
  { label: 'Tasks', value: 'tasks' },
];

export function MobileDayView() {
  const [tab, setTab] = useState<DayTab>('schedule');
  const [addingTask, setAddingTask] = useState(false);
  const { addTask, currentDate } = usePlannerStore();

  return (
    <div className="flex flex-col h-full relative bg-[var(--color-center-col)]">
      {/* Sub-tab bar */}
      <div className="flex-shrink-0 flex bg-[var(--color-canvas)] border-b border-[var(--color-border)]">
        {TABS.map((t) => {
          const isActive = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={[
                'flex-1 py-2.5 text-[12px] transition-colors',
                isActive
                  ? 'font-semibold text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                  : 'font-medium text-[var(--color-text-muted)]',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* View content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'schedule' ? (
          <SlotHeightProvider value={MOBILE_SLOT_HEIGHT}>
            <MyDayColumn />
          </SlotHeightProvider>
        ) : (
          <TasksTodayColumn borderRight={false} />
        )}
      </div>

      {/* FAB — only on Schedule tab, since Tasks tab has its own + button */}
      {tab === 'schedule' && !addingTask && (
        <button
          type="button"
          onClick={() => setAddingTask(true)}
          aria-label="Add task"
          className="absolute bottom-5 right-5 z-10 w-14 h-14 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.18)] active:scale-95 transition-transform"
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      {/* Inline task input anchored to bottom */}
      {addingTask && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-[var(--color-canvas)] border-t border-[var(--color-border)] px-4 py-4 rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <InlineTaskInput
            placeholder="Add task for today…"
            onSubmit={(title) => {
              addTask({ title, location: 'today', date: currentDate });
              setAddingTask(false);
            }}
            onCancel={() => setAddingTask(false)}
          />
        </div>
      )}
    </div>
  );
}
