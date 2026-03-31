'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAll } from '@/lib/api';
import type { LegacyPlannerData } from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';

// ─── Legacy localStorage helpers ────────────────────────────────────────────

function readLegacyData(): LegacyPlannerData | null {
  try {
    const raw = localStorage.getItem('planner-v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: LegacyPlannerData };
    const state = parsed?.state;
    if (!state) return null;
    const hasEntities =
      (state.tasks?.length           ?? 0) > 0 ||
      (state.projects?.length        ?? 0) > 0 ||
      (state.recurrentTasks?.length  ?? 0) > 0 ||
      (state.calendarEntries?.length ?? 0) > 0 ||
      (state.tags?.length            ?? 0) > 0;
    return hasEntities ? state : null;
  } catch {
    return null;
  }
}

function isBackendEmpty(data: Awaited<ReturnType<typeof fetchAll>>): boolean {
  return (
    data.tasks.length           === 0 &&
    data.projects.length        === 0 &&
    data.recurrentTasks.length  === 0 &&
    data.calendarEntries.length === 0 &&
    data.tags.length            === 0
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePlannerData(): {
  isLoading: boolean;
  error: string | null;
  legacyData: LegacyPlannerData | null;
  refresh: () => void;
} {
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [legacyData, setLegacyData] = useState<LegacyPlannerData | null>(null);
  const hydrateFromBackend          = usePlannerStore((s) => s.hydrateFromBackend);

  // Legacy data is captured once before the first hydrateFromBackend call.
  // Stored in a ref so subsequent refreshes don't re-check localStorage.
  const legacyRef       = useRef<LegacyPlannerData | null>(null);
  const firstLoadDone   = useRef(false);

  const refresh = useCallback(() => {
    fetchAll()
      .then((data) => {
        hydrateFromBackend(data);
        // Import banner: only evaluate on first successful load
        if (!firstLoadDone.current) {
          firstLoadDone.current = true;
          if (isBackendEmpty(data) && legacyRef.current) {
            setLegacyData(legacyRef.current);
          }
        }
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('[usePlannerData] Failed to load from backend:', err);
        setError('Could not connect to the server. Please refresh.');
        setIsLoading(false);
      });
  }, [hydrateFromBackend]);

  useEffect(() => {
    // Capture legacy localStorage data before the first hydrateFromBackend
    // fires (which causes Zustand's persist middleware to overwrite it).
    legacyRef.current = readLegacyData();

    refresh();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]); // refresh is stable (useCallback with stable hydrateFromBackend)

  return { isLoading, error, legacyData, refresh };
}
