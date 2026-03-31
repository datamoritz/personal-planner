'use client';

import type { AllDayEvent } from '@/types';

interface AllDayStripProps {
  events: AllDayEvent[];
}

export function AllDayStrip({ events }: AllDayStripProps) {
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1 border-b border-[var(--color-border)] flex-shrink-0">
      {events.map((ev) => (
        <div
          key={ev.id}
          title={ev.notes ?? ev.title}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium text-[#10b981] bg-[#10b981]/10 truncate select-none"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0" />
          {ev.title}
        </div>
      ))}
    </div>
  );
}
