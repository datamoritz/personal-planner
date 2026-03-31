'use client';

import { useEffect, useState } from 'react';
import { fetchAll } from '@/lib/api';
import type { LegacyPlannerData } from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';

// ─── Legacy localStorage helpers ────────────────────────────────────────────

/**
 * Read the old planner-v1 localStorage value before Zustand's persist
 * middleware overwrites it with the new partialized state (UI prefs only).
 * Must be called before any store set() — i.e. before hydrateFromBackend.
 */
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

/**
 * Boot hook — fetches all planner entities from the backend once on mount,
 * then hydrates the Zustand store. Returns loading/error state and, when
 * applicable, legacy localStorage data that should be offered for import.
 */
export function usePlannerData(): {
  isLoading: boolean;
  error: string | null;
  legacyData: LegacyPlannerData | null;
} {
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [legacyData, setLegacyData] = useState<LegacyPlannerData | null>(null);
  const hydrateFromBackend          = usePlannerStore((s) => s.hydrateFromBackend);

  useEffect(() => {
    let cancelled = false;

    // Capture legacy localStorage data NOW, before hydrateFromBackend triggers
    // a Zustand persist write that overwrites planner-v1 with UI prefs only.
    const legacy = readLegacyData();

    fetchAll()
      .then((data) => {
        if (cancelled) return;
        // hydrateFromBackend calls set() → persist middleware writes new
        // partialized state → old entity data in localStorage is gone after this.
        hydrateFromBackend(data);
        if (isBackendEmpty(data) && legacy) {
          setLegacyData(legacy);
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[usePlannerData] Failed to load from backend:', err);
        setError('Could not connect to the server. Please refresh.');
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isLoading, error, legacyData };
}
