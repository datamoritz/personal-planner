'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateMandala, reloadTracking } from './mandalaTracking';
import { fetchAll, hasPendingPlannerMutations } from '@/lib/api';
import { usePlannerStore } from '@/store/usePlannerStore';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePlannerData(): {
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hydrateFromBackend = usePlannerStore((s) => s.hydrateFromBackend);

  const sequence = useRef(0);
  const refresh = useCallback(() => {
    if (hasPendingPlannerMutations()) return;
    const current = ++sequence.current;
    evaluateMandala().catch(() => {}).then(() => fetchAll())
      .then(async (data) => {
        await reloadTracking().catch(() => {});
        if (current !== sequence.current || hasPendingPlannerMutations()) return;
        hydrateFromBackend(data);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (current !== sequence.current) return;
        console.error('[usePlannerData] Failed to load from backend:', err);
        setError('Could not connect to the server. Please refresh.');
        setIsLoading(false);
      });
  }, [hydrateFromBackend]);

  useEffect(() => {
    refresh();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    let pending: ReturnType<typeof setTimeout>;
    const invalidate = () => { sequence.current++; };
    const changed = () => { invalidate(); clearTimeout(pending); pending = setTimeout(refresh, 250); };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('planner-data-invalidated', invalidate);
    window.addEventListener('planner-tasks-changed', changed);
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearTimeout(pending); clearInterval(timer); window.removeEventListener('planner-data-invalidated', invalidate); window.removeEventListener('planner-tasks-changed', changed); window.removeEventListener('online', changed); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refresh]);

  return { isLoading, error, refresh };
}
