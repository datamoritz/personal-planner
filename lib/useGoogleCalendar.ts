'use client';

import { useCallback, useEffect, useRef } from 'react';
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { AllDayEvent, CalendarEntry } from '@/types';

const API_BASE = 'https://planner-api.moritzknodler.com';

export function useGoogleCalendar(): { refresh: () => void } {
  const currentDate               = usePlannerStore((s) => s.currentDate);
  const viewMode                  = usePlannerStore((s) => s.viewMode);
  const reconcileGoogleCalendarEntries = usePlannerStore((s) => s.reconcileGoogleCalendarEntries);
  const reconcileGoogleAllDayEvents = usePlannerStore((s) => s.reconcileGoogleAllDayEvents);
  const setGoogleNeedsReconnect   = usePlannerStore((s) => s.setGoogleNeedsReconnect);

  // Stable abort controller ref — cancelled on each new fetch and on unmount
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntries = useCallback(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    let start: string;
    let end: string;
    if (viewMode === 'week') {
      const base  = new Date(currentDate + 'T00:00:00');
      start = format(startOfWeek(base, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      end   = format(addDays(endOfWeek(base, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd');
    } else if (viewMode === 'month') {
      const base = new Date(currentDate + 'T00:00:00');
      start = format(startOfWeek(startOfMonth(base), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      end = format(addDays(endOfWeek(endOfMonth(base), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd');
    } else {
      start = currentDate;
      end   = format(addDays(new Date(currentDate + 'T00:00:00'), 1), 'yyyy-MM-dd');
    }

    abortRef.current?.abort();
    const controller  = new AbortController();
    abortRef.current  = controller;

    try {
      const url = `${API_BASE}/google/calendar-entries?start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        setGoogleNeedsReconnect(true);
        return;
      }
      const data: { timed: CalendarEntry[]; allDay: AllDayEvent[] } = await res.json();
      setGoogleNeedsReconnect(false);
      reconcileGoogleCalendarEntries(data.timed ?? []);
      reconcileGoogleAllDayEvents(data.allDay ?? []);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[Google Calendar] fetch failed:', err);
      setGoogleNeedsReconnect(true);
    }
  }, [currentDate, viewMode, reconcileGoogleAllDayEvents, reconcileGoogleCalendarEntries, setGoogleNeedsReconnect]);

  useEffect(() => {
    fetchEntries();
    return () => { abortRef.current?.abort(); };
  }, [fetchEntries]);

  return { refresh: fetchEntries };
}
