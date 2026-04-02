'use client';

import type { AllDayEvent } from '@/types';

interface AllDayStripProps {
  events: AllDayEvent[];
  onEventDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onEmptyDoubleClick?: (anchor: HTMLElement) => void;
}

export function AllDayStrip({ events, onEventDoubleClick, onEmptyDoubleClick }: AllDayStripProps) {
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1 border-b border-[var(--color-border)] flex-shrink-0 min-h-[28px]"
      onDoubleClick={(e) => {
        if (!onEmptyDoubleClick) return;
        if ((e.target as HTMLElement) !== e.currentTarget) return;
        onEmptyDoubleClick(e.currentTarget);
      }}
    >
      {events.map((ev) => (
        <div
          key={ev.id}
          title={ev.notes ?? ev.title}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium text-[#10b981] bg-[#10b981]/10 truncate select-none cursor-pointer"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEventDoubleClick?.(ev.id, e.currentTarget);
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0" />
          {ev.title}
        </div>
      ))}
    </div>
  );
}
