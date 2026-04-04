'use client';

import type { AllDayEvent } from '@/types';

interface AllDayStripProps {
  events: AllDayEvent[];
  onEventDoubleClick?: (id: string, anchor: HTMLElement) => void;
  onEmptyDoubleClick?: (anchor: HTMLElement) => void;
  onReadOnlyEventClick?: (event: AllDayEvent, anchor: HTMLElement) => void;
}

export function AllDayStrip({ events, onEventDoubleClick, onEmptyDoubleClick, onReadOnlyEventClick }: AllDayStripProps) {
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
          className={[
            'flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium truncate select-none',
            ev.source === 'apple_birthdays'
              ? 'text-[#b45309] bg-[color-mix(in_srgb,#f97316_10%,white_90%)] shadow-[0_6px_18px_rgba(249,115,22,0.08)] ring-1 ring-[#fdba74]/28'
              : 'text-[#10b981] bg-[#10b981]/10',
            ev.readOnly ? 'cursor-pointer' : 'cursor-pointer',
          ].join(' ')}
          onClick={(e) => {
            if (!ev.readOnly) return;
            onReadOnlyEventClick?.(ev, e.currentTarget);
          }}
          onDoubleClick={(e) => {
            if (ev.readOnly) return;
            e.stopPropagation();
            onEventDoubleClick?.(ev.id, e.currentTarget);
          }}
        >
          <span
            className={[
              'w-1.5 h-1.5 rounded-full flex-shrink-0',
              ev.source === 'apple_birthdays' ? 'bg-[#f59e0b]' : 'bg-[#10b981]',
            ].join(' ')}
          />
          <span className="truncate flex-1 min-w-0">{ev.title}</span>
          {ev.source === 'apple_birthdays' && ev.hasMessage && (
            <span className="flex-shrink-0 text-[10px] leading-none opacity-80">✓</span>
          )}
        </div>
      ))}
    </div>
  );
}
