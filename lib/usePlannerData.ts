'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAll } from '@/lib/api';
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

  const refresh = useCallback(() => {
    fetchAll()
      .then((data) => {
        hydrateFromBackend(data);
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
    refresh();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  return { isLoading, error, refresh };
}
